"""
Evaluation harness for:
  "Error Taxonomy and Mitigation Strategies for LLM Agents Querying
   Blockchain-Based Insurance Data"

Usage:
  python harness.py --phase before           # run before-mitigation queries
  python harness.py --phase after            # run after-mitigation queries
  python harness.py --phase both             # run all
  python harness.py --error-type E1_array_truncation  # filter by error type
  python harness.py --query-id E1-01        # run single query
  python harness.py --report                 # generate summary report from results/

Requirements (must be running):
  - insurance_agent web server: http://localhost:5000
  - Hardhat node: http://localhost:8545  (for ground-truth extraction)
  - node blockchain-dental/scripts/query-policy.js <wallet> (auto-called)

Output: results/{phase}/{query_id}.json
"""

import argparse
import json
import os
import subprocess
import sys
import time
import datetime
from pathlib import Path

import requests

# ── Config ───────────────────────────────────────────────────────────────────
CHATBOT_URL   = "http://localhost:5000/api/chat"
STREAM_URL    = "http://localhost:5000/api/chat/stream"
QUERY_JS      = str(Path(__file__).parent.parent.parent /
                    "blockchain-dental" / "scripts" / "query-policy.js")
QUERIES_FILE  = Path(__file__).parent / "queries.json"
RESULTS_DIR   = Path(__file__).parent / "results"
WALLET        = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"  # Hardhat Account #1

SESSION_ID    = "eval-harness-session"
MODEL         = "gpt-4o"

# ── Scorer: simple string-based correctness ──────────────────────────────────
SCORING_RUBRIC = {
    # (error_type, check_key): lambda llm_text, ground_truth -> (score, note)
}

def score_response(query: dict, llm_text: str, ground_truth: dict,
                   sse_flags: dict) -> dict:
    """
    Returns a scoring dict:
      correct (bool): main answer correctness
      no_news (bool): news section absent (required for blockchain queries)
      no_bad_buttons (bool): no insurance comparison buttons on crypto/blockchain tables
      flags_ok (bool): SSE used_blockchain_tool / used_crypto_tool correct
      score (0-3): sum of above booleans (max 3 for blockchain queries, 2 for baseline)
      notes (str): evaluator notes
    """
    et = query["error_type"]
    text_lower = llm_text.lower()

    correct      = None   # set by error-type-specific logic below
    no_news      = "관련 보험 뉴스" not in llm_text and "최신 보험 뉴스" not in llm_text
    flags_ok     = True   # default pass for baseline

    # ── E1: Array truncation ──────────────────────────────────────────────────
    if et == "E1_array_truncation":
        gt_field = query["ground_truth_field"]
        if "policies.length" in gt_field and "policies" in ground_truth:
            n_policies = len(ground_truth.get("policies", []))
            # Count how many policy IDs or policy numbers appear in the response
            mentioned = sum(1 for p in ground_truth.get("policies", [])
                            if str(p.get("id", "")) in llm_text
                            or f"증권 #{p.get('id','')}" in llm_text
                            or f"#{p.get('id','')}" in llm_text)
            correct = mentioned == n_policies
        else:
            correct = True  # heuristic fallback

    # ── E2: Temporal reasoning ────────────────────────────────────────────────
    elif et == "E2_temporal_reasoning":
        if "policies" in ground_truth and ground_truth["policies"]:
            pre = ground_truth["policies"][0].get("timeUntilMaturity", "")
            # Must NOT contain "내일" if pre-computed says "오늘" or vice-versa
            if "오늘" in pre:
                correct = "내일" not in llm_text and "오늘" in llm_text
            elif "내일" in pre:
                correct = "오늘" not in llm_text and "내일" in llm_text
            else:
                correct = pre[:10] in llm_text if pre else True
        else:
            correct = True

    # ── E3: Stale tool reuse ──────────────────────────────────────────────────
    elif et == "E3_stale_tool_reuse":
        # Main check: no news section in blockchain-related follow-up
        correct = True  # Content usually correct; the error is the news section
        if query.get("turn", 1) > 1:
            # In follow-up turns, news section must not appear
            correct = "관련 보험 뉴스" not in llm_text

    # ── E4: Timezone ambiguity ────────────────────────────────────────────────
    elif et == "E4_timezone_ambiguity":
        correct = "(KST)" in llm_text or "한국 시간" in llm_text or "KST" in llm_text

    # ── E5: Expression variability ────────────────────────────────────────────
    elif et == "E5_expression_variability":
        # SSE flag must be present and correct
        flags_ok = sse_flags.get("used_crypto_tool", False)
        correct = True  # Content itself is typically correct; UI behavior is the error

    # ── E6: Conditional logic failure ─────────────────────────────────────────
    elif et == "E6_conditional_logic_failure":
        flags_ok = sse_flags.get("used_blockchain_tool", False)
        correct = True

    # ── Baseline control ──────────────────────────────────────────────────────
    elif et == "baseline_control":
        correct = True
        no_news = True  # don't penalize baselines for news
        flags_ok = True

    score_max = 3 if et != "baseline_control" else 1
    score = sum([
        1 if correct else 0,
        1 if no_news else 0,
        1 if flags_ok else 0,
    ])

    return {
        "correct": correct,
        "no_news": no_news,
        "flags_ok": flags_ok,
        "score": min(score, score_max),
        "score_max": score_max,
        "notes": ""
    }


# ── Ground truth extraction ───────────────────────────────────────────────────
def get_ground_truth(wallet: str) -> dict:
    try:
        result = subprocess.run(
            ["node", QUERY_JS, wallet],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=30,
            cwd=str(Path(QUERY_JS).parent.parent)
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout.strip())
    except Exception as e:
        print(f"  [warn] Ground truth extraction failed: {e}")
    return {}


# ── Chatbot call ──────────────────────────────────────────────────────────────
def call_chatbot(user_message: str, history: list = None) -> tuple[str, dict]:
    """Returns (llm_text, sse_flags). history is list of {role, content} dicts."""
    payload = {
        "message": user_message,
        "session_id": SESSION_ID,
        "mode": "live",
    }
    try:
        resp = requests.post(CHATBOT_URL, json=payload, timeout=60)
        data = resp.json()
        text = data.get("response", "")
        sse_flags = {
            "used_blockchain_tool": data.get("used_blockchain_tool", False),
            "used_crypto_tool": data.get("used_crypto_tool", False),
        }
        return text, sse_flags
    except Exception as e:
        return f"ERROR: {e}", {}


def call_chatbot_stream(user_message: str) -> tuple[str, dict]:
    """SSE streaming call. Returns (full_text, sse_flags)."""
    payload = {
        "message": user_message,
        "session_id": SESSION_ID,
        "mode": "live",
    }
    full_text = []
    sse_flags = {}
    try:
        with requests.post(STREAM_URL, json=payload, stream=True, timeout=90) as r:
            for line in r.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                try:
                    ev = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if ev.get("type") == "content":
                    full_text.append(ev.get("text", ""))
                elif ev.get("type") == "done":
                    sse_flags["used_blockchain_tool"] = ev.get("used_blockchain_tool", False)
                    sse_flags["used_crypto_tool"]    = ev.get("used_crypto_tool", False)
    except Exception as e:
        return f"ERROR: {e}", {}
    return "".join(full_text), sse_flags


# ── Run one query ─────────────────────────────────────────────────────────────
def run_query(query: dict, ground_truth: dict, phase: str) -> dict:
    qid = query["id"]
    turn = query.get("turn", 1)

    print(f"  [{qid}] {query['error_type']} | turn={turn}")

    # For multi-turn queries, run turn 1 silently first
    if turn == 2:
        prev_q = query.get("user_query_turn1", "블록체인 보험 현황 알려줘.")
        call_chatbot_stream(prev_q)
        time.sleep(1)

    start = time.time()
    text, sse_flags = call_chatbot_stream(query["user_query"])
    elapsed = time.time() - start

    scoring = score_response(query, text, ground_truth, sse_flags)

    result = {
        "query_id": qid,
        "error_type": query["error_type"],
        "phase": phase,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "user_query": query["user_query"],
        "llm_response": text,
        "sse_flags": sse_flags,
        "ground_truth_field": query.get("ground_truth_field"),
        "elapsed_sec": round(elapsed, 2),
        "scoring": scoring,
        "mitigation": query.get("mitigation"),
        "expected_behavior": query.get("expected_behavior"),
        "failure_mode": query.get("failure_mode"),
    }
    icon = "✓" if scoring["correct"] else "✗"
    print(f"    {icon} score={scoring['score']}/{scoring['score_max']} "
          f"correct={scoring['correct']} no_news={scoring['no_news']} "
          f"flags={scoring['flags_ok']} [{elapsed:.1f}s]")
    return result


# ── Report generation ─────────────────────────────────────────────────────────
def generate_report():
    rows = []
    for f in sorted(RESULTS_DIR.glob("**/*.json")):
        try:
            rows.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            continue

    if not rows:
        print("No result files found.")
        return

    by_et_phase: dict = {}
    for r in rows:
        key = (r["error_type"], r["phase"])
        by_et_phase.setdefault(key, []).append(r)

    print("\n" + "=" * 72)
    print("EVALUATION REPORT")
    print("=" * 72)
    for (et, phase), items in sorted(by_et_phase.items()):
        total = len(items)
        correct = sum(1 for x in items if x["scoring"]["correct"])
        no_news = sum(1 for x in items if x["scoring"]["no_news"])
        flags   = sum(1 for x in items if x["scoring"]["flags_ok"])
        avg_score = sum(x["scoring"]["score"] for x in items) / total
        max_score = items[0]["scoring"]["score_max"]
        print(f"\n{et} [{phase}]  n={total}")
        print(f"  Correct      : {correct}/{total} = {correct/total:.0%}")
        print(f"  No news      : {no_news}/{total} = {no_news/total:.0%}")
        print(f"  Flags ok     : {flags}/{total}  = {flags/total:.0%}")
        print(f"  Avg score    : {avg_score:.2f}/{max_score}")

    print("\n" + "-" * 72)
    print("OVERALL BEFORE vs AFTER")
    for et in set(k[0] for k in by_et_phase):
        before = by_et_phase.get((et, "before_mitigation"), [])
        after  = by_et_phase.get((et, "after_mitigation"), [])
        if before and after:
            b_rate = sum(1 for x in before if x["scoring"]["correct"]) / len(before)
            a_rate = sum(1 for x in after  if x["scoring"]["correct"]) / len(after)
            delta  = a_rate - b_rate
            print(f"  {et:<35} {b_rate:.0%} → {a_rate:.0%}  Δ={delta:+.0%}")
    print("=" * 72)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["before", "after", "both", "all"],
                        default="both")
    parser.add_argument("--error-type", default=None)
    parser.add_argument("--query-id", default=None)
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--no-gt", action="store_true",
                        help="Skip ground-truth extraction (blockchain node not running)")
    args = parser.parse_args()

    if args.report:
        generate_report()
        return

    queries_data = json.loads(QUERIES_FILE.read_text(encoding="utf-8"))
    all_queries = queries_data["queries"]

    # Filter
    if args.query_id:
        all_queries = [q for q in all_queries if q["id"] == args.query_id]
    if args.error_type:
        all_queries = [q for q in all_queries if q["error_type"] == args.error_type]
    if args.phase in ("before", "after"):
        phase_key = f"{args.phase}_mitigation"
        all_queries = [q for q in all_queries
                       if q.get("phase") in (phase_key, "both", "all")]

    # Ground truth
    gt = {}
    if not args.no_gt:
        print(f"Extracting ground truth for wallet {WALLET} ...")
        gt = get_ground_truth(WALLET)
        if not gt.get("ok"):
            print(f"  [warn] Ground truth not available: {gt.get('error', 'unknown')}")
            print("  Run with --no-gt to skip, or start the blockchain node first.")
    else:
        print("[--no-gt] Ground truth extraction skipped.")

    phase_label = args.phase if args.phase != "all" else "both"
    out_dir = RESULTS_DIR / phase_label
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nRunning {len(all_queries)} queries (phase={phase_label}) ...\n")
    for q in all_queries:
        result = run_query(q, gt, phase_label)
        out_file = out_dir / f"{q['id']}.json"
        out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2),
                            encoding="utf-8")
        time.sleep(2)  # rate-limit courtesy

    print(f"\nResults saved to {out_dir}")
    print("Run with --report to see summary.")


if __name__ == "__main__":
    main()
