# Error Taxonomy and Mitigation Strategies for LLM Agents Querying Blockchain-Based Insurance Data

**[DRAFT v0.1 — 2026-11-14]**
**Target venue**: Applied Sciences (MDPI, SCIE) OR Future Internet (MDPI, SCIE)
**Deadline**: 2026-11-27

---

## Abstract

> *[TODO: Write after experiments — 150-200 words]*
> 
> Large language model (LLM) agents that invoke external tools to query structured data introduce a category of errors distinct from hallucination: errors that arise in the LLM's reasoning and presentation layer even when the underlying data retrieval is correct. We identify, classify, and measure this error category in a deployed insurance chatbot system that queries smart contract state on a local Ethereum-compatible blockchain. Through analysis of 50 systematically designed queries, we document six recurring error types — array truncation, temporal arithmetic mistakes, stale tool-result reuse, timezone ambiguity, response expression variability, and conditional UI logic failures — and propose four corresponding mitigation strategies. Our before/after evaluation demonstrates that the mitigations reduce error rates from [X%] to [Y%] on affected query types while leaving baseline (non-blockchain) query performance unchanged. These findings generalize to any LLM agent operating over structured real-time data sources and have particular relevance for high-stakes financial applications where incorrect responses carry regulatory and fiduciary risk.

**Keywords**: large language model, tool calling, blockchain, insurance, error taxonomy, smart contract, hallucination mitigation

---

## 1. Introduction

The integration of large language models with external tools has enabled a new class of conversational agents capable of querying real-time databases, APIs, and distributed ledgers [CITE]. In the insurance domain, such agents offer the promise of automated underwriting assistance, policy status queries, and claim processing — tasks that previously required human expertise and synchronous access to backend systems [CITE].

However, the tool-calling paradigm introduces a subtle failure mode that is distinct from the well-studied problem of LLM hallucination. When an agent correctly retrieves structured data from an external source but then makes errors in interpreting, presenting, or propagating that data to the user, the resulting response is incorrect despite the data layer being accurate. We term this class of errors **tool-layer presentation errors** (TLPEs), and observe that they exhibit consistent, recurring patterns across query types and sessions.

This paper makes three contributions:

1. **A six-class taxonomy of TLPEs** observed in a production-grade insurance chatbot that queries Ethereum smart contract state via tool-calling, grounded in real user-reported incidents (Section 4).

2. **Four mitigation strategies** that address the root cause of each error class — pre-computed string injection, explicit enumeration prompts, server-side tool-use flags, and history-aware tool tracking — evaluated through a 50-query before/after experiment (Section 5).

3. **Empirical evidence** that TLPEs are systematic (not random), that the same query reliably triggers the same error type, and that targeted mitigations reduce error rates by [X%] without degrading unrelated query performance (Section 6).

The system under study, InsureChain, combines a GPT-4o-based multi-agent insurance advisor with a Hardhat/Solidity smart contract backend handling dental insurance policies, parametric triggers, reinsurance pools, and cryptocurrency reserve management. This architecture represents a realistic instance of a broader class of LLM systems that must reliably report time-sensitive, legally significant data.

---

## 2. Related Work

### 2.1 LLM Tool-Calling and Agent Frameworks

> *[TODO: 1 page — cover ReAct, ToolFormer, function calling, OpenAI tool use, LangChain agents]*
>
> Key papers to cite:
> - Yao et al. (2022) ReAct: Synergizing Reasoning and Acting in Language Models
> - Schick et al. (2023) Toolformer: Language Models Can Teach Themselves to Use Tools
> - Mialon et al. (2023) Augmented Language Models survey
> - OpenAI Function Calling documentation
> - Qin et al. (2023) Tool Learning with Foundation Models

### 2.2 LLM Errors and Hallucination

> *[TODO: 0.5 page — distinguish our TLPE from hallucination]*
>
> Key papers:
> - Ji et al. (2023) Survey of Hallucination in Natural Language Generation
> - Huang et al. (2023) A Survey on Hallucination in Large Language Models
> - Shen et al. (2023) Do Large Language Models Know What They Don't Know?

### 2.3 Blockchain + Insurance Systems

> *[TODO: 0.5 page]*
>
> Key papers (from ⑫단계 Scopus search, 2026-11-12):
> - Islayem et al. (2025) Using LLMs for fraud analysis in blockchain based health insurance claims. *Scientific Reports*. — Closest work; focuses on fraud detection, not chatbot error taxonomy.
> - Etherisc, AXA Fizzy (parametric blockchain insurance) — industry precedents
> - Towards Trusted Automated Insurance: A Private Neuro-Symbolic Framework on Blockchain (ISCAIT 2026) — verify content

### 2.4 LLM in Financial Advisory

> *[TODO: 0.5 page]*
>
> Key papers:
> - ClaimPilot (Future Internet 2026) — LLM for insurance claims
> - State-Aware Dual-Tool Architecture (Applied Sciences 2026)
> - CryptoAnalystBench (arXiv 2602.11304) — evaluation methodology reference
> - FinGPT, BloombergGPT — domain-specific LLMs in finance

**Gap**: No prior work systematically classifies and measures tool-layer presentation errors in LLM agents operating on immutable blockchain data sources.

---

## 3. System Architecture

> *[TODO: 1–1.5 pages + 1 figure]*

### 3.1 InsureChain Overview

[Figure 1: System architecture diagram — chatbot ↔ orchestrator ↔ tool layer ↔ blockchain]

The system comprises three tightly coupled components:

1. **Insurance Advisory Chatbot** (`insurance_agent/`): A Flask-based web service hosting a GPT-4o multi-agent pipeline. The primary Orchestrator agent (`agents/orchestrator.py`) handles intent classification and tool dispatch. Two sub-agents handle personalized recommendation and underwriting review. The pipeline exposes 11 primary tools (search, retrieval, blockchain query, crypto reserve query) and 19 underwriting-specific tools.

2. **Blockchain dApp** (`blockchain-dental/`): A Hardhat-based local Ethereum node hosting five Solidity smart contracts: `DentalInsurance`, `ParametricInsurance`, `ReinsurancePool`, `AltInvestmentFund`, and `ReserveFund`. Contract state is authoritative and immutable per transaction.

3. **Integration Bridge**: Python tool functions (`tools/blockchain_tool.py`) invoke Node.js scripts (`scripts/query-*.js`) via subprocess, returning JSON representations of on-chain state. This design avoids adding Python web3 dependencies by reusing the existing ethers.js stack.

### 3.2 Tool-Calling Flow

```
User query → Orchestrator (GPT-4o)
  → tool_name="get_blockchain_dental_status"
    → blockchain_tool.py::get_blockchain_dental_status()
      → subprocess: node query-policy.js <wallet>
        → ethers.js → Hardhat node (localhost:8545)
        → JSON: {ok, policies:[...], ...}
      ← JSON decoded, returned to GPT-4o
  → GPT-4o synthesizes natural-language response
→ User
```

The critical observation is that errors can occur at **step 7** (GPT-4o synthesis) even when steps 1–6 are error-free. This is the layer our taxonomy targets.

### 3.3 Blockchain Data Characteristics

On-chain data has properties that amplify synthesis errors:

- **Immutability**: Timestamps are Unix epoch integers; GPT-4o must convert them to human-readable dates.
- **Array structures**: Policy arrays may contain 1–N items; GPT-4o must enumerate all.
- **Multi-turn continuity**: Users ask follow-up questions; GPT-4o may reuse cached tool results.
- **Regulatory implications**: Incorrect dates or amounts in insurance contexts carry fiduciary risk.

---

## 4. Error Taxonomy

> *[TODO: 2–2.5 pages — one subsection per error type with: definition, root cause, real incident, example, frequency]*

We identified six recurring error types through longitudinal analysis of user-reported incidents in the InsureChain deployment log. Each type was confirmed by: (a) a reproducible query sequence, (b) a documented before-state exhibiting the error, and (c) a confirmed root cause.

### 4.1 E1: Array Truncation Error

**Definition**: The LLM enumerates only a subset of items in an array returned by the tool, omitting the remainder without indication.

**Root cause**: GPT-4o applies a summarization heuristic when processing long structured outputs, selecting "representative" items rather than exhaustively listing all.

**Real incident** (2026-09-18): A user query asking for all policies received an answer covering only the first two of three policies. Direct inspection of the tool return value and `query-policy.js` output confirmed all three were present.

**Example**:
```
Tool output:  policies: [{id:1,...}, {id:2,...}, {id:3,...}]
GPT-4o resp: "첫 번째 증권(#1)과 두 번째 증권(#2)에 대해 말씀드리겠습니다..."
             [Policy #3 silently omitted]
```

**Trigger**: Occurs when the array contains ≥3 elements and GPT-4o's context budget is not explicitly constrained.

### 4.2 E2: Temporal Arithmetic Error

**Definition**: The LLM independently computes a date or duration from a raw timestamp, introducing rounding or unit errors.

**Root cause**: `Math.ceil(remainingSeconds / 86400)` returns 1 for any value in (0, 86400], meaning any policy expiring within the next 24 hours is reported as "tomorrow" even when it expires today.

**Real incident** (2026-09-18): User query "오늘 만기야, 아니면 내일?" received "내일 만기입니다" when the policy was expiring within hours.

**Example**:
```
maturityDate timestamp: T+28min
Correct answer: "오늘, 28분 후"
GPT-4o answer: "내일 만기됩니다"  (Math.ceil(1680/86400) = 1)
```

### 4.3 E3: Stale Tool-Result Reuse

**Definition**: In a multi-turn conversation, the LLM answers a follow-up query using a cached result from a previous turn without re-invoking the tool, while downstream logic (news section, UI flags) treats this as a non-blockchain response.

**Root cause**: GPT-4o's context window includes prior tool results; the model correctly infers the answer without re-calling the tool. However, the application's tool-use detection (`used_blockchain_tool` flag) only checked the current turn's tool calls, not previous turns.

**Real incident** (2026-09-18): User asked "내 보험 현황 보여줘" (turn 1 — tool called) then "이번 달 보험료 납입은 됐어?" (turn 2 — no tool call). The turn-2 response correctly answered but had an irrelevant insurance news section appended.

### 4.4 E4: Timezone Ambiguity Error

**Definition**: The LLM receives a timezone-unlabeled datetime string and interprets it inconsistently, producing timestamps that differ from the frontend display (which uses explicit KST).

**Root cause**: `toISOString()` produces a UTC string without timezone label (e.g., `"2026-09-18T11:15:05.000Z"`). GPT-4o re-interprets this string differently across sessions — sometimes as UTC, sometimes as local time — resulting in up to 9-hour discrepancies from the frontend's KST display.

**Real incident** (2026-09-18): User screenshot comparison showed chatbot responding "오후 8:15:05" and later "오전 11:15:05" for the same event timestamp.

### 4.5 E5: Response Expression Variability

**Definition**: The LLM describes the same factual state using different natural-language expressions across turns or sessions, causing frontend pattern-matching logic (which infers tool type from response text) to fail inconsistently.

**Root cause**: LLM non-determinism means "DRY_RUN=True" may be rendered as "DRY_RUN: true", "드라이 런(dry_run)", "모의 매매 모드", or "페이퍼(모의)" depending on context — none of which are reliable discriminators for frontend logic.

**Real incident** (2026-09-24): Frontend regex checking for "DRY_RUN" in response text to suppress insurance comparison buttons failed when GPT-4o used "드라이 런" phrasing, causing insurance buttons to appear on crypto performance tables.

### 4.6 E6: Conditional Logic Failure via Text Inference

**Definition**: The application attempts to infer which tool was called by pattern-matching the LLM's response text, rather than using a server-authoritative flag, leading to incorrect conditional behavior.

**Root cause**: Early implementation had the frontend decide whether to append an insurance news section or render comparison buttons by scanning for keywords in the LLM's response. Since LLM phrasing varies (E5), this classification was unreliable.

**Real incident** (2026-09-18 and 2026-09-24): Blockchain status queries inconsistently triggered the insurance news section; crypto performance tables inconsistently showed insurance product comparison buttons.

---

## 5. Mitigation Strategies

> *[TODO: 1.5 pages]*

We propose four targeted mitigations, each addressing the root cause of one or more error classes.

### 5.1 M1: Pre-Computed String Injection (→ E2, partially E4)

**Principle**: Delegate time-sensitive calculations to deterministic code; pass the pre-computed human-readable string to GPT-4o rather than raw timestamps.

**Implementation**: `query-policy.js` computes `timeUntilMaturity` and `timeUntilUnlock` using `Math.floor`-based duration logic identical to the frontend, formats the result as `"오늘, 28분 후"` or `"3일 4시간 후"`, and includes it in the JSON payload. The system prompt instructs GPT-4o to use this string verbatim.

```javascript
// query-policy.js (after mitigation)
function timeUntilMaturity(maturityTs) {
  const remaining = Math.max(0, Number(maturityTs) - Math.floor(Date.now()/1000));
  const d = Math.floor(remaining / 86400);
  const h = Math.floor((remaining % 86400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  if (d === 0 && h === 0) return `오늘, ${m}분 후`;
  if (d === 0) return `오늘, ${h}시간 ${m}분 후`;
  return `${d}일 ${h}시간 후`;
}
```

### 5.2 M2: Explicit Enumeration Prompt (→ E1)

**Principle**: Override GPT-4o's default summarization heuristic via system prompt instruction.

**Implementation**: The system prompt includes the directive: "policies 배열에 여러 개 있으면 하나도 빠짐없이 전부 포함, 일부만 요약해서 나머지를 빠뜨리지 말 것."

This is a prompt-level intervention with no code changes required. It is resilient to changes in array size.

### 5.3 M3: Server-Side Tool-Use Flags (→ E5, E6)

**Principle**: Replace text-based tool-type inference with authoritative boolean flags emitted by the server in the SSE event stream.

**Implementation**: The orchestrator (`agents/orchestrator.py`) tracks which tool categories were called in the current turn and emits `used_blockchain_tool` and `used_crypto_tool` as fields in the SSE `done` event. The frontend reads these flags directly — no text pattern matching.

```python
# orchestrator.py (after mitigation)
# In stream_chat():
yield json.dumps({
    "type": "done",
    "used_blockchain_tool": used_blockchain_tool,
    "used_crypto_tool": used_crypto_tool,
})
```

```javascript
// web_app.py frontend (after mitigation)
// addLinksToTables(htmlStr, skip=event.used_crypto_tool)
// News section: if (event.used_blockchain_tool) { skipNews = true; }
```

### 5.4 M4: History-Aware Tool Tracking (→ E3)

**Principle**: Extend tool-use detection beyond the current turn to include the most recent tool call in the conversation history.

**Implementation**: `_last_tool_call_names()` helper scans the conversation history for the most recent assistant message that contained tool_calls; if that call included `get_blockchain_dental_status`, the current turn is treated as a blockchain response even if no tool was called this turn.

```python
def _last_tool_call_names(self) -> list[str]:
    for msg in reversed(self.conversation_history):
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            return [tc["function"]["name"] for tc in msg["tool_calls"]]
    return []
```

**Combined with M5 (Explicit Timezone Labels — E4)**: `tsToDate()` in `query-policy.js` now uses `toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " (KST)"`, ensuring every datetime is unambiguously labelled.

---

## 6. Evaluation

> *[TODO: Fill in after experiments — 1.5 pages + 2 tables + 1 figure]*

### 6.1 Experimental Setup

**Query set**: 50 queries across 6 error types (Table 1), designed to target each error class specifically. For each error type, we include queries in both before-mitigation and after-mitigation conditions (5–8 queries per class). Five baseline queries verify that mitigations do not degrade non-blockchain performance.

**Before condition**: The orchestrator with (a) raw UTC ISO strings from `toISOString()`, (b) no enumeration prompt, (c) text-based tool detection, (d) current-turn-only tool tracking.

**After condition**: Current production system with M1–M4 applied.

**Evaluation model**: GPT-4o (gpt-4o-2024-11-20) with temperature=1 (default). Each query run 3 times; majority vote for binary metrics.

**Ground truth**: For structural queries (array lengths, timestamps), ground truth is extracted from `query-policy.js` output on a fixed blockchain state (Hardhat local node, Hardhat Account #1).

**Metrics**:
- **Correctness rate** (CR): proportion of queries with factually correct answers
- **News-free rate** (NF): proportion of blockchain responses without irrelevant news section
- **Flag accuracy** (FA): proportion of responses where SSE `used_*_tool` flag matches actual tool call

### 6.2 Results

> *[TODO: Fill in after running harness.py]*

**Table 1. Query distribution by error type and phase.**

| Error Type | Before | After | Baseline |
|---|---|---|---|
| E1 Array truncation | 3 | 3 | — |
| E2 Temporal arithmetic | 3 | 3 | — |
| E3 Stale reuse | 3 | 3 | — |
| E4 Timezone ambiguity | 3 | 3 | — |
| E5 Expression variability | 3 | 3 | — |
| E6 Conditional logic | 2 | 2 | — |
| Baseline | — | — | 5 |
| **Total** | **17** | **17** | **5+11 mixed** |

**Table 2. Error rates before and after mitigation (mean over 3 runs).**

> *[TODO: fill in with actual numbers]*

| Error Type | Before CR | After CR | Δ CR | Before NF | After NF | Δ NF |
|---|---|---|---|---|---|---|
| E1 | % | % | % | — | — | — |
| E2 | % | % | % | — | — | — |
| E3 | % | % | % | % | % | % |
| E4 | % | % | % | — | — | — |
| E5 | % | % | % | % | % | % |
| E6 | % | % | % | % | % | % |
| Baseline | % | % | 0% | — | — | — |

**Figure 2**: Before vs. after correctness rate by error type (bar chart). → `paper/draft/figures/fig2_before_after.png`

### 6.3 Discussion

> *[TODO after experiments]*

Key claims to support:
1. TLPEs are systematic, not random — same query reliably triggers same error type.
2. Mitigations are targeted — M1 fixes E2 without affecting E1 rates.
3. Baseline performance is unchanged — mitigations are additive, not disruptive.
4. Error rates before mitigation are non-trivial (expected: E1 ~40%, E2 ~90%, E3 ~60%, E4 ~70%, E5 ~80%, E6 ~60%).

---

## 7. Discussion

### 7.1 Generalizability

The six error types identified here are not specific to insurance or blockchain. They arise from two fundamental properties: (1) structured external data with numeric/temporal fields, and (2) a natural-language synthesis step by an LLM. Any system where an LLM must faithfully report arrays, timestamps, or status codes from a data source is susceptible to the same taxonomy.

### 7.2 Implications for LLM-Integrated Financial Systems

> *[TODO]*

Insurance and financial applications carry heightened stakes: an incorrect maturity date can cause a customer to miss a claim window; an incorrect DRY_RUN status can cause a user to believe real trades are being executed when they are not. Our taxonomy provides a checklist for developers of such systems.

### 7.3 Limitations

1. **Single model**: All experiments use GPT-4o. Error rates and mitigation effectiveness may differ for other models (GPT-4o-mini, Claude, Llama).

2. **Local testnet**: The blockchain node is a local Hardhat instance with synthetic data. Real mainnet deployments may exhibit different latency characteristics affecting response quality.

3. **Sample size**: 50 queries across 6 classes yields small per-class samples (8–10). Statistical significance is limited; this study is best interpreted as a taxonomy + feasibility demonstration.

4. **Manual scoring**: Correctness scoring is semi-automated; some cases require human judgment.

### 7.4 Future Work

- Replication on GPT-4o-mini, Claude 3.5 Sonnet to test model dependence
- Extension to mainnet (Polygon, Ethereum) with real policy data
- Automated LLM-as-judge scoring to reduce human annotation overhead
- Integration with formal verification of smart contract responses

---

## 8. Conclusion

We presented a six-class taxonomy of tool-layer presentation errors (TLPEs) in an LLM agent that queries blockchain-based insurance data, grounded in production incidents and evaluated through a 50-query before/after experiment. The taxonomy — covering array truncation, temporal arithmetic, stale tool-result reuse, timezone ambiguity, response expression variability, and conditional logic failure — identifies systematic failure modes that persist even when the underlying data retrieval is correct. Four targeted mitigations reduce aggregate error rates from [X%] to [Y%] without degrading baseline query performance. These findings provide both a diagnostic framework and a practical mitigation toolkit for developers building LLM agents over structured real-time data sources.

---

## References

> *[TODO: format in journal style — IEEE or APA depending on target venue]*
>
> Key references to include:
> 1. Yao et al. (2022). ReAct: Synergizing Reasoning and Acting in LMs. arXiv.
> 2. Schick et al. (2023). Toolformer. NeurIPS.
> 3. Ji et al. (2023). Survey of Hallucination. ACM Comput. Surv.
> 4. Islayem et al. (2025). Using LLMs for fraud in blockchain health insurance. Sci. Rep.
> 5. ClaimPilot paper (Future Internet, 2026).
> 6. State-Aware Dual-Tool (Applied Sciences, 2026).
> 7. CryptoAnalystBench (arXiv 2602.11304).
> 8. OpenAI Function Calling documentation.
> 9. Huang et al. (2023). A Survey on Hallucination in LLMs.
> 10. [Add blockchain + insurance refs from Scopus search]

---

## Appendix A — Full Query Set

> *See `paper/eval/queries.json`*

## Appendix B — Implementation Details

> *Available at: https://github.com/leeyonsei78/capstone_project_beta*
