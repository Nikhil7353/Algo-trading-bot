"""
StockBot — Autonomous Auto-Trader Daemon Engine
Monitors watchlist in background, evaluates active strategies, executes paper/live orders,
manages dynamic trailing stop-losses, and dispatches real-time Telegram/WhatsApp alerts.
"""
import threading
import logging
from datetime import datetime
from decimal import Decimal
from typing import List, Dict, Any, Optional

from django.utils import timezone
from core.config import get_settings
from core.models import Position, TradeLog, Signal
from data.fetcher import DataFetcher
from strategies.engine import StrategyEngine
from alerts.telegram import send_trade_executed_alert, send_position_closed_alert
from alerts.whatsapp import send_whatsapp_trade_alert, send_whatsapp_position_closed_alert

logger = logging.getLogger("stockbot.autotrader")


class AutoTrader:
    _instance: Optional["AutoTrader"] = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(AutoTrader, cls).__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.is_running = False
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.scan_interval: int = 60  # seconds
        self.last_scan_time: Optional[datetime] = None
        self.trades_executed_today: int = 0
        self.logs: List[Dict[str, Any]] = []
        self.max_logs: int = 50

    def log(self, message: str, level: str = "info"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        entry = {
            "timestamp": timestamp,
            "message": message,
            "level": level,
        }
        self.logs.insert(0, entry)
        if len(self.logs) > self.max_logs:
            self.logs.pop()
        
        # Safe ASCII string for Windows console logging (prevents charmap UnicodeEncodeError)
        console_msg = message.encode("ascii", "replace").decode("ascii")
        if level == "error":
            logger.error(console_msg)
        elif level == "warning":
            logger.warning(console_msg)
        else:
            logger.info(console_msg)

    def start(self, interval_seconds: Optional[int] = None):
        with self._lock:
            if self.is_running:
                return False, "Auto-Trader is already running."
            if interval_seconds:
                self.scan_interval = max(10, interval_seconds)
            self._stop_event.clear()
            self.is_running = True
            self._thread = threading.Thread(target=self._run_loop, daemon=True, name="AutoTraderDaemon")
            self._thread.start()
            self.log(f"Auto-Trader daemon STARTED (Scan Interval: {self.scan_interval}s)", "info")
            return True, "Auto-Trader started successfully."

    def stop(self):
        with self._lock:
            if not self.is_running:
                return False, "Auto-Trader is not running."
            self.is_running = False
            self._stop_event.set()
            self.log("Auto-Trader daemon STOPPED by user", "warning")
            return True, "Auto-Trader stopped successfully."

    def get_status(self) -> Dict[str, Any]:
        open_positions = Position.objects.filter(is_open=True).count()
        return {
            "is_running": self.is_running,
            "scan_interval": self.scan_interval,
            "last_scan_time": self.last_scan_time.strftime("%Y-%m-%d %H:%M:%S") if self.last_scan_time else None,
            "trades_executed_today": self.trades_executed_today,
            "active_positions_count": open_positions,
            "logs": self.logs,
        }

    def _run_loop(self):
        while not self._stop_event.is_set():
            try:
                self._scan_and_execute()
            except Exception as e:
                self.log(f"Scan cycle exception: {str(e)}", "error")

            # Wait for scan interval or until stop is requested
            self._stop_event.wait(timeout=self.scan_interval)

    def _scan_and_execute(self):
        self.last_scan_time = datetime.now()
        settings = get_settings()
        watchlist = settings.watchlist or ["RELIANCE", "SBIN", "INFY", "TCS", "TATAMOTORS", "ITC"]
        active_strategies = settings.active_strategies or ["supertrend", "vwap", "ema_crossover"]

        self.log(f"Scanning {len(watchlist)} symbols with strategies {active_strategies}…", "info")

        # 0. Reconcile Pending Live Orders from Broker Order Book
        if settings.mode == "live":
            from execution.executor import executor
            rec = executor.reconcile_orders()
            if rec.get("updated", 0) > 0:
                self.log(f"🔄 Reconciled {rec['updated']} live broker order status update(s)", "info")

        # 1. Manage Existing Open Positions (Trailing Stop-Loss & Take-Profit)
        self._manage_open_positions(settings)

        # 2. Check risk constraints before evaluating new entries
        open_count = Position.objects.filter(is_open=True).count()
        max_concurrent = getattr(settings, "max_open_positions", 5) or 5
        if open_count >= max_concurrent:
            self.log(f"Max concurrent positions reached ({open_count}/{max_concurrent}). Skipping new entries.", "info")
            return

        # 3. Scan Watchlist for New High-Confidence Breakout Signals
        fetcher = DataFetcher()
        engine = StrategyEngine(strategy_names=active_strategies)

        for symbol in watchlist:
            if self._stop_event.is_set():
                break

            # Skip if we already have an open position in this symbol
            if Position.objects.filter(symbol=symbol, is_open=True).exists():
                continue

            try:
                df = fetcher.fetch_historical(symbol, interval="15m", days=5)
                if df is None or len(df) < 20:
                    continue

                signals = engine.analyze(symbol, df)
                for sig in signals:
                    # Look for BUY signals with high strength
                    if sig.action.upper() == "BUY" and sig.strength >= 0.65:
                        self.log(f"⚡ [BREAKOUT] {symbol} generated {sig.action} via {sig.strategy} (Strength: {sig.strength:.2f})", "info")
                        self._execute_auto_buy(sig, settings)
                        # Only take 1 trade per symbol per scan
                        break
            except Exception as ex:
                self.log(f"Error evaluating {symbol}: {str(ex)}", "warning")

    def _manage_open_positions(self, settings):
        """Monitor open positions for trailing stop-loss, stop-loss hit, or take-profit hit."""
        open_positions = Position.objects.filter(is_open=True)
        if not open_positions.exists():
            return

        fetcher = DataFetcher()
        trailing_sl_pct = Decimal(str(getattr(settings, "trailing_stop_loss_pct", 1.0) or 1.0))

        for pos in open_positions:
            try:
                current_price_float = fetcher.fetch_live_price(pos.symbol)
                if not current_price_float or current_price_float <= 0:
                    continue
                current_price = Decimal(str(current_price_float))
                pos.current_price = current_price

                # Calculate unrealized P&L
                if pos.side == "LONG":
                    pnl = (current_price - pos.entry_price) * pos.quantity
                    pnl_pct = ((current_price - pos.entry_price) / pos.entry_price) * 100
                    pos.unrealized_pnl = pnl

                    # Dynamic Trailing Stop-Loss calculation:
                    # If current price rises, move stop-loss up
                    trail_threshold = pos.entry_price * (Decimal("1.0") + (trailing_sl_pct / Decimal("100.0")))
                    if current_price > trail_threshold:
                        new_sl = current_price * (Decimal("1.0") - (Decimal(str(settings.stop_loss_pct)) / Decimal("100.0")))
                        if new_sl > pos.stop_loss:
                            old_sl = pos.stop_loss
                            pos.stop_loss = new_sl
                            self.log(f"🛡️ [TRAILING SL] {pos.symbol} Stop-Loss raised: Rs{old_sl:.2f} -> Rs{new_sl:.2f}", "info")

                    # Check Exit Conditions (Stop Loss or Take Profit)
                    if current_price <= pos.stop_loss:
                        self.log(f"🛑 [STOP LOSS HIT] {pos.symbol} @ Rs{current_price:.2f} (SL: Rs{pos.stop_loss:.2f})", "warning")
                        self._close_position(pos, current_price, "STOP_LOSS", settings)
                    elif current_price >= pos.take_profit:
                        self.log(f"🎯 [TAKE PROFIT HIT] {pos.symbol} @ Rs{current_price:.2f} (TP: Rs{pos.take_profit:.2f})", "info")
                        self._close_position(pos, current_price, "TAKE_PROFIT", settings)
                    else:
                        pos.save(update_fields=["current_price", "unrealized_pnl", "stop_loss"])
            except Exception as e:
                self.log(f"Error managing position {pos.symbol}: {str(e)}", "error")

    def _execute_auto_buy(self, signal, settings):
        """Validates through RiskManager, then creates paper order + position."""
        from risk.manager import get_risk_manager
        from execution.executor import OrderExecutor

        entry_price_float = float(signal.price)
        rm = get_risk_manager()

        # Honour all risk gates: daily loss, position limits, order-rate limits, cooldown
        approved, quantity, reason = rm.validate_signal(signal.symbol, "BUY", entry_price_float)
        if not approved:
            self.log(f"Auto-buy for {signal.symbol} rejected by RiskManager: {reason}", "warning")
            return

        # Generate AI explanation for signal
        explanation = ""
        try:
            from ai_assistant.services import SignalExplainer
            explanation = SignalExplainer.explain_signal(
                symbol=signal.symbol,
                strategy=signal.strategy,
                action=signal.action,
                price=entry_price_float,
                metadata=signal.metadata or {},
            )
        except Exception:
            pass

        # Persist signal record
        db_sig = Signal.objects.create(
            symbol=signal.symbol,
            strategy=signal.strategy,
            action=signal.action,
            price=Decimal(str(entry_price_float)),
            strength=signal.strength,
            explanation=explanation,
            metadata_json=signal.metadata or {},
        )

        # Place order via executor (handles paper vs live routing)
        executor = OrderExecutor()
        order_id = executor.place_order(
            signal.symbol, "BUY", quantity, entry_price_float, signal_id=db_sig.id
        )
        if not order_id:
            self.log(f"Auto-buy order failed for {signal.symbol}", "error")
            return

        # Register with RiskManager and open position
        rm.register_order()
        pos = rm.open_position(signal.symbol, "BUY", quantity, entry_price_float)

        self.trades_executed_today += 1
        self.log(
            f"✅ [AUTO TRADE] Bought {quantity}x {signal.symbol} @ Rs{entry_price_float:.2f} "
            f"(SL: Rs{pos.stop_loss:.2f}, TP: Rs{pos.take_profit:.2f})",
            "info",
        )

        # Dispatch Real-Time Alerts (Telegram & WhatsApp)
        try:
            send_trade_executed_alert(
                symbol=signal.symbol,
                side="BUY",
                qty=quantity,
                price=entry_price_float,
                stop_loss=pos.stop_loss,
                take_profit=pos.take_profit,
                mode="Paper (AutoBot)",
            )
            send_whatsapp_trade_alert(
                symbol=signal.symbol,
                side="BUY",
                qty=quantity,
                price=entry_price_float,
                stop_loss=pos.stop_loss,
                take_profit=pos.take_profit,
                mode="Paper (AutoBot)",
            )
        except Exception as alert_err:
            logger.warning(f"Alert dispatch error: {str(alert_err)}")

    def _close_position(self, pos: Position, exit_price: Decimal, reason: str, settings):
        """Closes open position, logs realized TradeLog, and sends alerts."""
        pnl = (exit_price - pos.entry_price) * pos.quantity
        pnl_pct = float(((exit_price - pos.entry_price) / pos.entry_price) * 100)

        # Record TradeLog
        TradeLog.objects.create(
            symbol=pos.symbol,
            side="SELL",
            quantity=pos.quantity,
            entry_price=pos.entry_price,
            exit_price=exit_price,
            pnl=pnl,
            pnl_pct=pnl_pct,
            strategy=f"Auto-{reason}",
            pnl_type="REALIZED",
        )

        # Close position — zero out unrealized_pnl since the trade is now realized
        pos.is_open = False
        pos.closed_at = timezone.now()
        pos.unrealized_pnl = Decimal("0.0")
        pos.save(update_fields=["is_open", "closed_at", "current_price", "unrealized_pnl"])

        self.log(f"🏁 [POSITION CLOSED] {pos.symbol} exited @ Rs{exit_price:.2f} | Realized P&L: Rs{pnl:.2f} ({pnl_pct:+.2f}%) [{reason}]", "info")

        # Dispatch Real-Time Alerts
        try:
            send_position_closed_alert(
                symbol=pos.symbol,
                pnl=float(pnl),
                pnl_pct=pnl_pct,
                reason=reason,
            )
            send_whatsapp_position_closed_alert(
                symbol=pos.symbol,
                pnl=float(pnl),
                pnl_pct=pnl_pct,
                reason=reason,
            )
        except Exception as alert_err:
            logger.warning(f"Close alert dispatch error: {str(alert_err)}")


# Global singleton instance
auto_trader = AutoTrader()
