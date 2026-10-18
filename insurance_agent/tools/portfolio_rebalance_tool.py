"""
보험 리밸런싱 분석: 기존 가입 보험(또는 신규 가입설계)을 건강검진 위험 분석 결과와 비교해
유지/보강/조정/해지 판단, 신규 추가 담보, 보험다모아 상품 제안을 만든다.

판단 자체는 규칙 기반(결정론적)이고, 자연어 설명은 /api/rebalance-ai 가 GPT로 덧붙인다.
건강 위험 산출은 tools/health_risk_tool.assess_health_risk 를 그대로 재사용한다.
"""
import json

from tools.health_risk_tool import assess_health_risk

# 화면 select 값과 동일하게 유지 (web_app.py 의 rb-type 옵션)
HOLDING_TYPES = ["실손의료보험", "암보험", "질병보험", "종신보험", "간병·치매보험", "치아보험", "기타"]

# 보험 종류별 보장금액 최소 권장치(만원). 실손은 정액 보장이 아니라 해당 없음.
_MIN_COVERAGE_10K = {"암보험": 3000, "질병보험": 3000, "종신보험": 5000, "간병·치매보험": 2000}


def _to_int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def _fmt_won(n: int) -> str:
    if n >= 100_000_000 and n % 100_000_000 == 0:
        return f"{n // 100_000_000}억원"
    if n >= 10_000:
        return f"{n / 10_000:,.1f}".rstrip("0").rstrip(".") + "만원"
    return f"{n:,}원"


def summarize_coverage_items(items):
    """[{name, amount_won}] → ("암사망 1,000만원, 일반암진단 2,000만원, ...", 대표 진단금(만원) 또는 None)"""
    parts, rep = [], None
    for it in items or []:
        name = str((it or {}).get("name") or "").strip()
        amt = _to_int((it or {}).get("amount_won"))
        if not name or amt <= 0:
            continue
        parts.append(f"{name} {_fmt_won(amt)}")
        if rep is None and ("일반암" in name or name == "암진단" or name == "암진단비"):
            rep = amt // 10_000
    return ", ".join(parts[:12]), rep


# 암보험에서 흔히 함께 확인하는 세부 보장(입력된 보장 내역에 키워드가 없으면 '확인 필요'로만 안내)
_CANCER_SUB_COVERAGES = [("유사암", "유사암(소액암) 진단"), ("표적", "표적항암약물치료"), ("재진단", "암 재진단/재발")]


# 건강 소견 → 상품 보장 내용에서 찾을 키워드 (적합도 정렬용, 규칙 기반)
_FIT_KEYWORDS = {
    "고혈압 의심": ["뇌", "심근", "심장", "혈관", "고혈압"],
    "이상지질혈증 의심": ["뇌", "심근", "심장", "혈관"],
    "간수치 이상": ["간"],
    "비만(BMI≥25)": ["당뇨", "대사", "심근", "뇌"],
    "현재 흡연": ["폐", "암", "뇌", "심근"],
}


def _fit_keywords(health: dict) -> set:
    kws = set()
    for f in health.get("input_summary", {}).get("flags", []):
        kws.update(_FIT_KEYWORDS.get(f, []))
    if health.get("risk_assessment", {}).get("risk_band") in ("중간위험", "고위험"):
        kws.update(["당뇨", "합병증"])
    cr = health.get("cancer_risk")
    if isinstance(cr, dict) and cr.get("band") in ("중위험", "고위험"):
        kws.add("암")
    return kws


def _local_products(t: str, age: int, gender: str) -> list:
    """보험다모아 엑셀이 없을 때 쓰는 로컬 정적 DB 폴백(실손·종신 등 일부 유형만 존재)"""
    try:
        from data.products import ALL_PRODUCTS
    except Exception:
        return []
    out = []
    for p in ALL_PRODUCTS:
        # type 필드가 넓은 분류('실손의료보험'에 암보험이 섞임 등)라 상품명 키워드로 한 번 더 거른다
        kw = {"실손의료보험": "실손", "종신보험": "종신", "암보험": "암", "질병보험": "질병"}.get(t, t)
        if not (p.get("subtype") == t or (p.get("type") == t and kw in p.get("name", ""))):
            continue
        mp = p.get("monthly_premium") or {}
        key = f"{age // 10 * 10}세_{gender[:1]}"
        prem = mp.get(key) or next(iter(mp.values()), None)
        out.append({
            "company": p.get("company", ""), "product_name": p.get("name", ""),
            "premium": f"월 약 {prem:,}원" if isinstance(prem, int) else "문의",
            "source": "로컬 상품DB(참고용, 연령·조건에 따라 상이)",
        })
    return out[:3]


def _needed_coverages(health: dict) -> dict:
    """건강 위험 분석 결과 → 필요한 담보 {type: {priority, reason}} (priority 1이 가장 높음)"""
    ra = health.get("risk_assessment", {})
    ins = health.get("input_summary", {})
    cr = health.get("cancer_risk") or {}
    age = ins.get("age") or 0
    flags = [f for f in ins.get("flags", []) if f != "특이소견 없음"]
    band = ra.get("risk_band", "")

    need = {"실손의료보험": {"priority": 1, "reason": "의료비 실비 보장은 연령·위험도와 무관한 기본 담보"}}

    if band in ("중간위험", "고위험") or flags:
        why = f"당뇨·대사 위험 {band}" + (f", 임상 소견({', '.join(flags)})" if flags else "")
        need["질병보험"] = {"priority": 2, "reason": why + " → 진단비·입원비 보장 필요"}

    cancer_band = cr.get("band") if isinstance(cr, dict) else None
    if cancer_band in ("중위험", "고위험") or age >= 40:
        need["암보험"] = {
            "priority": 2 if cancer_band == "고위험" else 3,
            "reason": (f"암 위험 {cancer_band}" if cancer_band else f"{age}세 암 발생률 상승 구간") + " → 진단비 확보",
        }

    low_survival = any(
        (c.get("5yr_survival_pct") or 100) < 50 for c in (cr.get("top3_cancers") or [])
    ) if isinstance(cr, dict) else False
    if age >= 55 or low_survival:
        need["간병·치매보험"] = {"priority": 3, "reason": "55세 이상 또는 저생존율 암종 → 장기 간병비 대비"}
        need["종신보험"] = {"priority": 4, "reason": "고령·고위험 → 사망보장 및 상속 대비"}

    return need


def analyze_portfolio(health_input: dict, holdings: list, plan_mode: str = "existing") -> str:
    """
    health_input: assess_health_risk 인자 dict (age, gender, height, ... bfc_tier)
    holdings: [{type, company, name, premium(월 원), coverage_10k(만원)}]
    plan_mode: 'existing'(기존 가입내역) | 'new_plan'(신규 가입설계안)
    """
    health = json.loads(assess_health_risk(include_products=True, **health_input))

    clean = []
    for h in holdings or []:
        t = h.get("type") if h.get("type") in HOLDING_TYPES else "기타"
        clean.append({
            "type": t,
            "company": (h.get("company") or "").strip(),
            "name": (h.get("name") or "").strip(),
            "premium": max(_to_int(h.get("premium")), 0),
            "coverage_10k": max(_to_int(h.get("coverage_10k")), 0),
            "coverages": (h.get("coverages") or "").strip()[:400],  # 이미지/텍스트에서 추출한 보장 내역 원문(표시·AI 설명용)
        })

    need = _needed_coverages(health)
    verb_keep = "유지" if plan_mode == "existing" else "가입 적합"
    verb_drop = "해지 검토" if plan_mode == "existing" else "가입 비권장"

    actions = []
    seen_types = {}
    for h in clean:
        seen_types.setdefault(h["type"], []).append(h)

    for t, items in seen_types.items():
        # 실손 중복: 비례보상이라 보험료만 이중 부담
        if t == "실손의료보험" and len(items) > 1:
            keep = min(items, key=lambda x: x["premium"] or 10**12)
            for h in items:
                if h is keep:
                    actions.append({**h, "action": verb_keep, "reason": "실손 중복 중 보험료가 가장 낮은 계약 — 하나만 남기면 충분"})
                else:
                    actions.append({**h, "action": verb_drop, "reason": "실손은 비례보상이라 중복 가입 시 보험료만 이중 부담"})
            continue
        for h in items:
            if t in need:
                min_cov = _MIN_COVERAGE_10K.get(t)
                if min_cov and h["coverage_10k"] and h["coverage_10k"] < min_cov:
                    basis = "일반암진단 기준" if t == "암보험" else "대표 보장금액 기준"
                    actions.append({**h, "action": "보장 보강",
                                    "reason": f"{need[t]['reason']} / {basis} 현재 {h['coverage_10k']:,}만원 < 권장 {min_cov:,}만원"})
                else:
                    actions.append({**h, "action": verb_keep, "reason": need[t]["reason"]})
            elif t == "기타":
                actions.append({**h, "action": "내용 확인", "reason": "종류 미분류 — 보장 내용을 확인해 위험 대비 필요 여부 판단"})
            else:
                actions.append({**h, "action": "조정 검토",
                                "reason": "현재 건강 위험 대비 우선순위가 낮은 담보 — 보험료 부담 크면 감액·납입중지 검토"})

    gaps = []
    for t, info in sorted(need.items(), key=lambda kv: kv[1]["priority"]):
        if t not in seen_types:
            gaps.append({"type": t, "priority": info["priority"], "reason": info["reason"],
                         "min_coverage_10k": _MIN_COVERAGE_10K.get(t)})

    # 신규 추가 담보에 대한 보험다모아 상품 제안 (건강 분석에서 이미 조회한 유형은 재사용)
    # suggested: 화면 '보험다모아 제안 상품'용 (공시 보험료 낮은 순 상위 3개)
    # candidates: AI 리포트용 넓은 후보군(상위 10개, 보장 내용 포함) — AI가 건강 위험 적합도로 골라 추천하게 한다
    suggested, candidates = {}, {}
    age = health["input_summary"]["age"]
    gender = health_input.get("gender", "남")
    ag = f"{min(max(age // 10 * 10, 30), 60)}대"  # 40대 = 40~49세
    fit_kw = _fit_keywords(health)
    for g in gaps:
        t = g["type"]
        results, basis = [], None
        try:
            from tools.excel_search_tool import search_insmarket_products

            def _search(**kw):
                raw = search_insmarket_products(insurance_type=t, top_n=10, **kw)
                td = json.loads(raw) if isinstance(raw, str) else raw
                return td.get("results") or []
            results = _search(gender=gender, age_group=ag)
            if not results:
                # 공시 엑셀에 이 성별·연령대 파일이 없으면 다른 조건 파일을 참고용으로 보여준다 (가짜 보험사명보다 낫다)
                results = _search()
                if results:
                    ctx = results[0].get("file_context") or {}
                    basis = (f"공시 엑셀에 {gender}성 {ag} 자료가 없어 "
                             f"{ctx.get('gender', '')} {ctx.get('age_group', '') or '연령 무관'} 기준 자료를 참고용으로 표시합니다. "
                             "실제 보험료는 가입 조건에 따라 다릅니다.").replace("  ", " ")
        except Exception:
            results = []
        if results:
            suggested[t] = [dict(r, basis_note=basis) if basis else r for r in results[:3]]
            cands = []
            for r in results[:10]:
                text = " ".join([r.get("product_name") or "", r.get("notes") or ""] + list(r.get("coverages") or []))
                hits = sorted({kw for kw in fit_kw if kw in text})
                cands.append({
                    "company": r.get("company"), "product_name": r.get("product_name"), "premium": r.get("premium"),
                    "coverages": (r.get("coverages") or [])[:5], "notes": (r.get("notes") or "")[:80],
                    "fit_hits": hits,
                })
            # 건강 소견과 맞는 보장 키워드가 많은 순 (동점이면 기존 보험료 낮은 순 유지) → 화면의 최저가 목록과 순서가 달라진다
            cands.sort(key=lambda c: -len(c["fit_hits"]))
            candidates[t] = cands
        else:
            local = _local_products(t, age, gender)
            if local:
                suggested[t] = local
                candidates[t] = local
    unsourced = [g["type"] for g in gaps if g["type"] not in suggested]

    notes = []
    if clean and not any(h["premium"] for h in clean):
        notes.append("월 보험료가 입력되지 않아 예산 비교를 할 수 없습니다. 보험료를 입력하면 권장 범위와 비교해 드립니다.")
    if clean:
        notes.append("부족한 담보는 '입력하신 보험 기준'입니다. 입력하지 않은 다른 계약(실손 등)이 있다면 추가 입력 후 다시 분석하세요.")
    for h in clean:
        if h["type"] == "암보험" and h["coverages"]:
            missing = [label for kw, label in _CANCER_SUB_COVERAGES if kw not in h["coverages"]]
            if missing:
                notes.append(f"{h['company']} {h['name']}".strip() + f": 입력된 보장에 {', '.join(missing)} 항목이 없습니다. 해당 특약 유무를 증권에서 확인하세요.")

    total_premium = sum(h["premium"] for h in clean)
    bfc = health.get("bfc_info") or {}
    budget = None
    if bfc:
        mx = bfc.get("budget_max_10k", 0) * 10000
        budget = {
            "min_10k": bfc.get("budget_min_10k"), "max_10k": bfc.get("budget_max_10k"),
            "label": bfc.get("label"),
            "status": "초과" if total_premium > mx else "범위 내",
            "gap_won": total_premium - mx,
        }

    return json.dumps({
        "plan_mode": plan_mode,
        "health": health,
        "holdings": clean,
        "needed": need,
        "actions": actions,
        "gaps": gaps,
        "suggested_products": suggested,
        "candidate_products": candidates,   # AI 리포트 전용(넓은 후보군)
        "unsourced_gap_types": unsourced,   # 엑셀·로컬DB 모두 상품이 없는 담보 → AI 리포트에서 웹검색으로 보완
        "notes": notes,
        "total_premium": total_premium,
        "budget": budget,
    }, ensure_ascii=False, indent=2)
