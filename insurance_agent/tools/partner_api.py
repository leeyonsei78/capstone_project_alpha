"""
B2B 파트너 API 키 관리 — 외부 GA(보험대리점)/핀테크가 챗봇의 블록체인 조회
기능을 자체 시스템에서 직접 호출할 수 있도록 키 발급/검증/사용량 계량을
제공한다. DB가 없는 이 프로젝트의 기존 관례대로 JSON 파일에 저장한다
(예: data/insmarket_excel_cache.json, data/wellness_checkins.json과 동일 패턴).

실제 조회 로직은 중복 구현하지 않고 tools/blockchain_tool.py의
get_blockchain_dental_status를 그대로 재사용한다 (web_app.py에서 호출).
"""
from __future__ import annotations

import json
import os
import secrets
import time

_KEYS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "partner_api_keys.json")


def _load() -> list[dict]:
    if not os.path.exists(_KEYS_PATH):
        return []
    try:
        with open(_KEYS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save(keys: list[dict]) -> None:
    with open(_KEYS_PATH, "w", encoding="utf-8") as f:
        json.dump(keys, f, ensure_ascii=False, indent=2)


def list_keys() -> list[dict]:
    return _load()


def issue_key(partner_name: str, monthly_quota: int = 10000) -> dict:
    keys = _load()
    new_key = {
        "key": "pk_" + secrets.token_hex(20),
        "partner_name": partner_name,
        "created_at": int(time.time()),
        "active": True,
        "call_count": 0,
        "last_used_at": None,
        "monthly_quota": monthly_quota,
    }
    keys.append(new_key)
    _save(keys)
    return new_key


def revoke_key(key: str) -> bool:
    keys = _load()
    found = False
    for k in keys:
        if k["key"] == key:
            k["active"] = False
            found = True
    if found:
        _save(keys)
    return found


def validate_key(key: str) -> dict | None:
    """유효하고 활성 상태인 키 레코드를 반환, 아니면 None."""
    if not key:
        return None
    for k in _load():
        if k["key"] == key and k["active"]:
            return k
    return None


def record_usage(key: str) -> None:
    keys = _load()
    for k in keys:
        if k["key"] == key:
            k["call_count"] = k.get("call_count", 0) + 1
            k["last_used_at"] = int(time.time())
            break
    _save(keys)
