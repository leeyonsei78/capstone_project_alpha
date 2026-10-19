"""
언더라이팅 서브에이전트(agents/orchestrator.py)가 route="human_review"로 확정한
심사 건을 관리자가 확인·처리할 대기열. DB가 없는 이 프로젝트의 기존 관례대로
JSON 파일에 저장한다 (tools/partner_api.py, data/wellness_checkins.json과 동일 패턴).

이 챗봇의 언더라이팅 심사는 익명 대화형 Q&A라 신청자 식별 정보(이름·연락처)가
없다 — 그래서 관리자가 승인/거절을 확정해도 그 결과를 고객에게 자동으로 돌려줄
방법이 없고, 이 큐는 "관리자가 무슨 건이 왜 수동심사로 넘어왔는지 확인하고 결정을
기록해 두는" 내부 기록 용도다. 기존 증권/청구 이메일 알림처럼 고객에게 결과를
통지하려면 먼저 신청자 연락처를 수집하는 단계가 선행되어야 하며, 이번 범위에는
포함하지 않는다.
"""
from __future__ import annotations

import json
import os
import secrets
import time

_QUEUE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "underwriting_review_queue.json"
)


def _load() -> list[dict]:
    if not os.path.exists(_QUEUE_PATH):
        return []
    try:
        with open(_QUEUE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save(items: list[dict]) -> None:
    with open(_QUEUE_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def enqueue(request_text: str, decision: dict) -> dict:
    """route="human_review"로 확정된 심사 결론 1건을 대기열에 추가한다."""
    items = _load()
    item = {
        "id": "ur_" + secrets.token_hex(8),
        "created_at": int(time.time()),
        "request_text": request_text,
        "tier": decision.get("tier"),
        "reasons": decision.get("reasons") or [],
        "missing_items": decision.get("missing_items") or [],
        "customer_message": decision.get("customer_message", ""),
        "status": "pending",      # pending | resolved
        "resolution": None,       # approved | rejected (resolved 될 때만 채워짐)
        "admin_note": "",
        "resolved_at": None,
    }
    items.append(item)
    _save(items)
    return item


def list_queue(status: str | None = None) -> list[dict]:
    """status가 주어지면 그 상태만, 생략하면 전체를 최신순으로 반환."""
    items = _load()
    if status:
        items = [it for it in items if it.get("status") == status]
    return sorted(items, key=lambda it: it["created_at"], reverse=True)


def get_item(item_id: str) -> dict | None:
    for it in _load():
        if it["id"] == item_id:
            return it
    return None


def resolve(item_id: str, resolution: str, admin_note: str = "") -> bool:
    """대기열 항목을 승인(approved)/거절(rejected)로 확정한다."""
    if resolution not in ("approved", "rejected"):
        return False
    items = _load()
    found = False
    for it in items:
        if it["id"] == item_id:
            it["status"] = "resolved"
            it["resolution"] = resolution
            it["admin_note"] = admin_note
            it["resolved_at"] = int(time.time())
            found = True
            break
    if found:
        _save(items)
    return found


def pending_count() -> int:
    return len(list_queue("pending"))
