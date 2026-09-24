"""
헤드리스 자동매매 스케줄러 (app.py의 Streamlit UI 루프를 대체).

app.py는 브라우저 탭이 열려 있는 동안만 st.rerun()으로 폴링하는 1인용 루프였다.
이 스크립트는 그 루프를 UI 없이 콘솔 프로세스로 빼서, blockchain-dental의
premium-scheduler.js 등 백그라운드 서비스와 동일한 방식(항상 켜져 있는 상태로
insurance_agent/crypto_bridge.py가 idempotent하게 기동·감시)으로 돌아가게 한다.

⚠️ DRY_RUN(config.json, 기본 True) — 잔고·현재가·평가손익 조회는 실제 업비트
데이터 그대로 쓰고, 오직 매수/매도 "주문 체결"만 막는다. 자세한 내용은
trade_bot.py의 _place_buy_order/_place_sell_order 주석 참고.
"""

import sys
import os

# [Windows cp949 대응] trade_bot.py 안에는 이모지가 섞인 print()가 다수 있다.
# insurance_agent/web_app.py에서 이미 한 번 "print()에 이모지 → 콘솔이 cp949일 때
# UnicodeEncodeError로 프로세스 자체가 죽는" 문제를 겪었다(CLAUDE.md 기록). 이 스크립트는
# 새 콘솔 프로세스로 기동되므로 같은 문제를 그대로 물려받는다 — 이모지를 일일이 걷어내는
# 대신, 이 프로세스의 stdout/stderr 인코딩 자체를 UTF-8(대체 문자 허용)로 재설정해 원천 차단.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import json
import signal
import time
from datetime import datetime

import pyupbit
import config as bot_config
from trade_bot import TradingBot

LOOP_INTERVAL_SEC = 60  # app.py 원본과 동일한 폴링 주기
BOT_ID = "default"  # 지금은 단일 고객/단일 봇. 고객별 멀티인스턴스화 시 이 값만 분리하면 됨.

_stop_requested = False


def _handle_stop_signal(signum, frame):
    global _stop_requested
    print(f"[scheduler] 종료 신호({signum}) 수신 — 현재 사이클 완료 후 정상 종료합니다.")
    _stop_requested = True


def _status_snapshot_path(bot_id):
    state_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(state_dir, exist_ok=True)
    return os.path.join(state_dir, f"status_snapshot_{bot_id}.json")


def _build_and_save_status_snapshot(bot):
    """insurance_agent/tools/crypto_reserve_tool.py(get_crypto_reserve_status)가 읽는
    조회용 스냅샷. run_once()는 매 사이클 티커 하나만 순환 처리하므로(round-robin),
    전체 종목의 "현재" 잔고·시세를 보려면 여기서 전 종목을 따로 다시 조회해야 한다.
    현재가 조회(pyupbit.get_current_price)는 인증이 필요 없는 순수 조회 API이고,
    잔고 조회(bot.get_balance)도 이미 실제 업비트 데이터를 쓰는 기존 메서드 그대로다
    — 즉 이 스냅샷도 "조회는 실제 데이터"라는 원칙을 그대로 따른다.
    """
    tickers = bot.config.get("TICKERS", [])
    prices = {}
    try:
        raw = pyupbit.get_current_price(tickers)
        if isinstance(raw, dict):
            prices = raw
        elif len(tickers) == 1 and raw is not None:
            prices = {tickers[0]: raw}
    except Exception as e:
        print(f"[scheduler] 현재가 스냅샷 조회 실패(치명적이지 않음): {e}")

    positions = []
    for ticker in tickers:
        pos = bot.positions.get(ticker, {})
        coin_code = ticker.split("-")[1]
        try:
            balance = bot.get_balance(coin_code) or 0
        except Exception:
            balance = 0
        price = prices.get(ticker)
        avg_price = pos.get("average_buy_price") or 0
        pnl_percent = pnl_krw = None
        if price and avg_price:
            pnl_percent = ((price - avg_price) / avg_price) * 100
            pnl_krw = (price - avg_price) * balance
        buy_time = pos.get("buy_time")
        positions.append({
            "ticker": ticker,
            "balance": balance,
            "average_buy_price": avg_price,
            "current_price": price,
            "unrealized_pnl_percent": pnl_percent,
            "unrealized_pnl_krw": pnl_krw,
            "highest_price": pos.get("highest_price"),
            "stop_loss_price": pos.get("stop_loss_price"),
            "target_price": pos.get("target_price"),
            "buy_time": buy_time.isoformat() if hasattr(buy_time, "isoformat") else buy_time,
        })

    try:
        krw_balance = bot.get_balance("KRW") or 0
    except Exception:
        krw_balance = None

    snapshot = {
        "bot_id": bot.bot_id,
        "dry_run": bot.config.get("DRY_RUN", True),
        "krw_balance": krw_balance,
        "daily_trade_count": bot.daily_trade_count,
        "max_trades_per_day": bot.config.get("MAX_TRADES_PER_DAY"),
        "positions": positions,
        "updated_at": datetime.now().isoformat(),
    }
    try:
        with open(_status_snapshot_path(bot.bot_id), "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[scheduler] 상태 스냅샷 저장 실패(치명적이지 않음): {e}")


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))  # config.json은 이 폴더 기준 상대경로

    signal.signal(signal.SIGINT, _handle_stop_signal)
    signal.signal(signal.SIGTERM, _handle_stop_signal)

    cfg = bot_config.get_config_data()
    dry_run = cfg.get("DRY_RUN", True)
    print("=" * 60)
    print(f"[scheduler] 가상자산 자동매매 헤드리스 스케줄러 시작 ({datetime.now()})")
    print(f"[scheduler] DRY_RUN = {dry_run} (True면 조회는 실제, 주문 체결만 억제)")
    print(f"[scheduler] TICKERS = {cfg.get('TICKERS')}")
    print("=" * 60)

    bot = TradingBot(cfg, bot_id=BOT_ID)

    if not bot.upbit:
        print("[scheduler] 업비트 연결 실패 — config.json의 ACCESS_KEY/SECRET_KEY를 확인하세요.")
        print("[scheduler] 연결 없이는 조회도 되지 않으므로 스케줄러를 종료합니다.")
        return

    _build_and_save_status_snapshot(bot)  # 첫 사이클(60초) 전에도 조회 도구가 쓸 데이터를 남김

    while not _stop_requested:
        cycle_start = time.time()
        try:
            log_msg, trade_result, stop_bot, stop_reason = bot.run_once()
            if log_msg:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] {log_msg}")
            if trade_result:
                print(f"  └ 체결 기록: {trade_result}")
            # 매 사이클 종료 시점에 리스크관리 상태(손절가/익절가/최고가/매수시각)를 저장.
            # trade_bot.py 내부 여러 return 지점을 일일이 쫓는 대신, 사이클 단위로 한 번만
            # 저장하는 쪽이 훨씬 단순하고 안전하다(최악의 경우도 최근 60초 분만 유실).
            bot._save_risk_state()
            _build_and_save_status_snapshot(bot)
            if stop_bot:
                print(f"[scheduler] 봇 정지 조건 도달: {stop_reason} — 스케줄러를 종료합니다.")
                break
        except Exception as e:
            # 원본 auto_upbit CLAUDE.md에 기록된 미해결 버그들이 있으므로, 사이클 하나가
            # 예외로 죽더라도 스케줄러 프로세스 전체는 살아남아 다음 사이클을 계속 시도한다.
            print(f"[scheduler] run_once() 사이클 중 오류(다음 사이클에 재시도): {e}")

        elapsed = time.time() - cycle_start
        sleep_for = max(0.0, LOOP_INTERVAL_SEC - elapsed)
        for _ in range(int(sleep_for)):
            if _stop_requested:
                break
            time.sleep(1)

    print(f"[scheduler] 정상 종료 ({datetime.now()})")


if __name__ == "__main__":
    main()
