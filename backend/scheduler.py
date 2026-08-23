"""Run StockBot's fetch -> scan -> risk-check -> execute cycle.

Usage:
    python scheduler.py --once --ignore-market-hours
    python scheduler.py --interval 300
"""

import argparse
import os
import time
from datetime import datetime, time as clock_time
from zoneinfo import ZoneInfo

import django
import schedule

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "stockbot.settings")
django.setup()

from core.config import get_settings
from core.logger import trade_log
from core.models import Signal
from data.fetcher import DataFetcher
from execution.executor import OrderExecutor
from risk.manager import get_risk_manager
from strategies.engine import StrategyEngine


MARKET_TZ = ZoneInfo("Asia/Kolkata")
SQUARE_OFF_TIME = clock_time(15, 15)


def is_market_open(settings) -> bool:
    """Return whether the configured Indian-equity market session is open."""
    now = datetime.now(MARKET_TZ)
    if now.weekday() >= 5:
        return False
    start = clock_time.fromisoformat(settings.market_start)
    end = clock_time.fromisoformat(settings.market_end)
    return start <= now.time() <= end


def is_past_square_off_time() -> bool:
    """Return True if the current time is past 15:15 IST on a weekday."""
    now = datetime.now(MARKET_TZ)
    if now.weekday() >= 5:
        return False
    return now.time() >= SQUARE_OFF_TIME


class TradingScheduler:
    def __init__(self):
        self.settings = get_settings()
        self.fetcher = DataFetcher()
        self.engine = StrategyEngine()
        self.executor = OrderExecutor()
        self.risk_manager = get_risk_manager()

    def check_open_positions(self) -> int:
        """Inspect all active positions against Stop-Loss and Take-Profit limits."""
        exits_triggered = 0
        symbols_to_check = list(self.risk_manager.positions.keys())

        for symbol in symbols_to_check:
            price = self.fetcher.fetch_live_price(symbol)
            if not price or price <= 0:
                continue

            should_exit, reason, pos = self.risk_manager.check_sl_tp(symbol, price)
            if should_exit and pos:
                trade_log.logger.warning("SL/TP Trigger for %s: %s", symbol, reason)
                order_id = self.executor.place_order(
                    symbol=symbol,
                    side="SELL" if pos.side in ("BUY", "LONG") else "BUY",
                    quantity=pos.quantity,
                    price=price,
                )
                if order_id:
                    self.risk_manager.register_order()
                    pnl = self.risk_manager.close_position(symbol, price)
                    trade_log.logger.info(
                        "Auto-exit executed for %s @ Rs%s. Realized P&L: Rs%s (%s)",
                        symbol, price, pnl, reason
                    )
                    exits_triggered += 1

        return exits_triggered

    def run_cycle(self) -> dict:
        """Execute the full active monitoring, risk management, and scanning cycle."""
        summary = {"sl_tp_exits": 0, "scanned": 0, "signals": 0, "executed": 0, "rejected": 0, "squared_off": 0}

        # 0. Reconcile pending live orders from Angel One order book
        if self.settings.mode == "live":
            self.executor.reconcile_orders()

        # 1. Check if intraday square-off time has passed (15:15 IST)
        if is_past_square_off_time() and self.risk_manager.positions:
            trade_log.logger.warning("Market square-off time reached (15:15 IST). Closing all positions.")
            prices = {sym: self.fetcher.fetch_live_price(sym) for sym in self.risk_manager.positions}
            closed = self.risk_manager.square_off_all(prices, reason="15:15_EOD_SQUAREOFF")
            summary["squared_off"] = len(closed)
            self.risk_manager.save_daily_performance()
            return summary

        # 2. Check open positions for SL/TP breaches
        summary["sl_tp_exits"] = self.check_open_positions()

        # If it's too late in the day (after 15:00), don't take new positions
        now_time = datetime.now(MARKET_TZ).time()
        if now_time >= clock_time(15, 0):
            trade_log.logger.info("Past 15:00 IST: skipping new signal entry scans")
            self.risk_manager.save_daily_performance()
            return summary

        # 3. Scan watchlist for new entry signals
        for symbol in self.settings.watchlist:
            data = self.fetcher.fetch_historical(symbol)
            if data.empty:
                trade_log.logger.warning("No data available for %s", symbol)
                continue

            summary["scanned"] += 1
            for signal in self.engine.analyze(symbol, data):
                db_signal = Signal.objects.create(
                    symbol=signal.symbol,
                    strategy=signal.strategy,
                    action=signal.action,
                    price=signal.price,
                    strength=signal.strength,
                    metadata_json=signal.metadata or {},
                )
                summary["signals"] += 1
                if self._execute_signal(db_signal):
                    summary["executed"] += 1
                elif signal.action != "HOLD":
                    summary["rejected"] += 1

        # 4. Save daily performance snapshot
        self.risk_manager.save_daily_performance()
        trade_log.logger.info("Scheduler cycle complete: %s", summary)
        return summary

    def _execute_signal(self, signal: Signal) -> bool:
        approved, quantity, reason = self.risk_manager.validate_signal(
            signal.symbol, signal.action, float(signal.price)
        )
        if not approved:
            if signal.action != "HOLD":
                trade_log.logger.info("Signal rejected for %s: %s", signal.symbol, reason)
            return False

        order_id = self.executor.place_order(
            signal.symbol,
            signal.action,
            quantity,
            float(signal.price),
            signal_id=signal.id,
        )
        if not order_id:
            trade_log.logger.error("Order failed for %s", signal.symbol)
            return False

        self.risk_manager.register_order()
        if signal.action == "SELL":
            self.risk_manager.close_position(signal.symbol, float(signal.price))
        else:
            self.risk_manager.open_position(
                signal.symbol, signal.action, quantity, float(signal.price)
            )
        return True


def main():
    parser = argparse.ArgumentParser(description="Run the StockBot trading scheduler")
    parser.add_argument("--interval", type=int, default=300, help="Seconds between cycles")
    parser.add_argument("--once", action="store_true", help="Run one cycle and exit")
    parser.add_argument(
        "--ignore-market-hours",
        action="store_true",
        help="Allow a cycle outside configured weekday market hours",
    )
    args = parser.parse_args()
    if args.interval <= 0:
        parser.error("--interval must be greater than zero")

    scheduler = TradingScheduler()

    def run_if_open():
        if args.ignore_market_hours or is_market_open(scheduler.settings):
            scheduler.run_cycle()
        else:
            trade_log.logger.info("Scheduler skipped: market is closed")

    if args.once:
        run_if_open()
        return

    run_if_open()
    schedule.every(args.interval).seconds.do(run_if_open)
    while True:
        schedule.run_pending()
        time.sleep(1)


if __name__ == "__main__":
    main()
