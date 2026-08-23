from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from django.utils import timezone

from core.config import get_settings
from core.logger import trade_log


@dataclass
class Position:
    symbol: str
    side: str
    quantity: int
    entry_price: float
    entry_time: datetime
    stop_loss: float = 0.0
    take_profit: float = 0.0
    current_price: float = 0.0

    @property
    def unrealized_pnl(self) -> float:
        if self.side == "BUY":
            return (self.current_price - self.entry_price) * self.quantity
        return (self.entry_price - self.current_price) * self.quantity

    @property
    def unrealized_pnl_pct(self) -> float:
        if self.entry_price == 0:
            return 0.0
        return self.unrealized_pnl / (self.entry_price * self.quantity) * 100


class RiskManager:
    def __init__(self, capital: float = None, persist_db: bool = True):
        settings = get_settings()
        self.persist_db = persist_db
        self.capital = capital or settings.capital
        self.current_capital = self.capital
        self.max_position_pct = settings.max_position_pct
        self.max_daily_loss_pct = settings.max_daily_loss_pct
        self.max_open_positions = settings.max_open_positions
        self.stop_loss_pct = settings.stop_loss_pct
        self.take_profit_pct = settings.take_profit_pct
        self.max_orders_per_minute = settings.max_orders_per_minute
        self.max_orders_per_day = settings.max_orders_per_day
        self.cooldown_sec = settings.cooldown_after_loss_sec

        self.positions: Dict[str, Position] = {}
        self.daily_orders = 0
        self.daily_pnl = 0.0
        self.winning_trades = 0
        self.losing_trades = 0
        self.peak_capital = self.capital
        self.max_drawdown = 0.0
        self._order_timestamps: List[datetime] = []
        self._loss_cooldown_until: Optional[datetime] = None

    def load_from_db(self):
        """Restore positions and state cleanly from the database without cumulative subtraction."""
        try:
            from core.models import Position as PositionModel, TradeLog as TradeLogModel
            settings = get_settings()
            self.capital = float(settings.capital or 25000)
            self.max_position_pct = float(settings.max_position_pct or 25.0)
            self.max_daily_loss_pct = float(settings.max_daily_loss_pct or 5.0)
            self.max_open_positions = int(settings.max_open_positions or 5)

            # Rebuild open positions map
            self.positions.clear()
            invested = 0.0
            unrealized = 0.0

            for db_pos in PositionModel.objects.filter(is_open=True):
                pos_entry = float(db_pos.entry_price)
                pos_qty = int(db_pos.quantity)
                pos_cmp = float(db_pos.current_price or db_pos.entry_price)
                pos_sl = float(db_pos.stop_loss or 0)
                pos_tp = float(db_pos.take_profit or 0)

                pos_pnl = (pos_cmp - pos_entry) * pos_qty if db_pos.side == "LONG" else (pos_entry - pos_cmp) * pos_qty
                invested += pos_entry * pos_qty
                unrealized += pos_pnl

                self.positions[db_pos.symbol] = Position(
                    symbol=db_pos.symbol,
                    side="BUY" if db_pos.side == "LONG" else "SELL",
                    quantity=pos_qty,
                    entry_price=pos_entry,
                    entry_time=db_pos.opened_at if db_pos.opened_at else timezone.now(),
                    stop_loss=pos_sl,
                    take_profit=pos_tp,
                    current_price=pos_cmp,
                )

            # Calculate today's realized trades
            today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
            today_trades = TradeLogModel.objects.filter(created_at__gte=today_start)
            if today_trades.exists():
                self.daily_pnl = float(sum(t.pnl for t in today_trades))
                self.winning_trades = today_trades.filter(pnl__gt=0).count()
                self.losing_trades = today_trades.filter(pnl__lt=0).count()
                self.daily_orders = today_trades.count()

            # Total account equity = initial capital + realized PnL + unrealized PnL
            self.current_capital = self.capital + self.daily_pnl + unrealized

            trade_log.logger.info(f"Loaded {len(self.positions)} open positions from DB (Equity: Rs{self.current_capital:.2f})")
        except Exception as e:
            trade_log.log_error("RiskManager DB load", e)

    def can_trade(self, now=None, opening: bool = True) -> tuple:
        if now is None:
            now = timezone.now()

        settings = get_settings()
        self.max_open_positions = settings.max_open_positions
        self.max_daily_loss_pct = settings.max_daily_loss_pct

        if self._loss_cooldown_until and now < self._loss_cooldown_until:
            remaining = (self._loss_cooldown_until - now).total_seconds()
            return False, f"Loss cooldown: {remaining}s remaining"

        if self.daily_orders >= self.max_orders_per_day:
            return False, f"Max daily orders ({self.max_orders_per_day}) reached"

        recent = [t for t in self._order_timestamps if (now - t).total_seconds() < 60]
        if len(recent) >= self.max_orders_per_minute:
            return False, f"Max orders/min ({self.max_orders_per_minute}) reached"

        loss_pct = abs(self.daily_pnl) / self.capital * 100 if self.daily_pnl < 0 else 0
        if loss_pct >= self.max_daily_loss_pct:
            return False, f"Max daily loss ({self.max_daily_loss_pct}%) reached"

        if opening and len(self.positions) >= self.max_open_positions:
            return False, f"Max positions ({self.max_open_positions}) reached"

        return True, "OK"

    def validate_signal(self, symbol: str, action: str, price: float, now=None) -> tuple:
        action = action.upper()
        if action == "HOLD":
            return False, 0, "HOLD signal"

        if action not in {"BUY", "SELL"}:
            return False, 0, f"Unsupported action: {action}"

        can, reason = self.can_trade(now, opening=action == "BUY")
        if not can:
            return False, 0, reason

        if action == "BUY" and symbol in self.positions:
            return False, 0, f"Already have position in {symbol}"

        if action == "SELL":
            position = self.positions.get(symbol)
            if position is None:
                return False, 0, f"No position to sell in {symbol}"
            return True, position.quantity, "Approved"

        max_amount = self.current_capital * (self.max_position_pct / 100)
        qty = int(max_amount / price) if price > 0 else 0

        # For small capital accounts, allow 1 share if total capital covers the share price
        if qty <= 0 and self.current_capital >= price > 0:
            qty = 1

        if qty <= 0:
            return False, 0, "Insufficient capital"

        return True, qty, "Approved"

    def calc_stop_loss(self, price: float, side: str) -> float:
        if side == "BUY":
            return round(price * (1 - self.stop_loss_pct / 100), 2)
        return round(price * (1 + self.stop_loss_pct / 100), 2)

    def calc_take_profit(self, price: float, side: str) -> float:
        if side == "BUY":
            return round(price * (1 + self.take_profit_pct / 100), 2)
        return round(price * (1 - self.take_profit_pct / 100), 2)

    def register_order(self, now=None):
        self._order_timestamps.append(now or timezone.now())
        self.daily_orders += 1

    def open_position(self, symbol: str, side: str, qty: int, price: float, now=None) -> Position:
        sl = self.calc_stop_loss(price, side)
        tp = self.calc_take_profit(price, side)
        pos = Position(
            symbol=symbol, side=side, quantity=qty,
            entry_price=price, entry_time=now or timezone.now(),
            stop_loss=sl, take_profit=tp, current_price=price,
        )
        self.positions[symbol] = pos
        self.current_capital -= price * qty
        trade_log.log_position(symbol, qty, price)
        self._save_position_to_db(pos)
        return pos

    def close_position(self, symbol: str, exit_price: float, now=None) -> Optional[float]:
        if symbol not in self.positions:
            return None
        pos = self.positions.pop(symbol)
        pos.current_price = exit_price
        pnl = pos.unrealized_pnl
        self.current_capital += exit_price * pos.quantity
        self.daily_pnl += pnl

        if pnl > 0:
            self.winning_trades += 1
        else:
            self.losing_trades += 1
            self._loss_cooldown_until = (now or timezone.now()) + timedelta(seconds=self.cooldown_sec)

        if self.current_capital > self.peak_capital:
            self.peak_capital = self.current_capital
        dd = (self.peak_capital - self.current_capital) / self.peak_capital * 100
        self.max_drawdown = max(self.max_drawdown, dd)

        trade_log.log_position(symbol, 0, exit_price, pnl)
        self._close_position_in_db(pos, exit_price, pnl)
        return pnl

    def _save_position_to_db(self, pos: Position):
        if not self.persist_db:
            return
        try:
            from core.models import Position as PositionModel
            db_side = "LONG" if pos.side in ("BUY", "LONG") else "SHORT"
            PositionModel.objects.update_or_create(
                symbol=pos.symbol,
                defaults={
                    "side": db_side,
                    "quantity": pos.quantity,
                    "entry_price": pos.entry_price,
                    "current_price": pos.current_price,
                    "stop_loss": pos.stop_loss,
                    "take_profit": pos.take_profit,
                    "is_open": True,
                },
            )
        except Exception as e:
            trade_log.log_error("DB position save", e)

    def _close_position_in_db(self, pos: Position, exit_price: float, pnl: float):
        if not self.persist_db:
            return
        try:
            from core.models import Position as PositionModel, TradeLog
            PositionModel.objects.filter(symbol=pos.symbol, is_open=True).update(
                current_price=exit_price,
                unrealized_pnl=pnl,
                is_open=False,
                closed_at=timezone.now(),
            )
            TradeLog.objects.create(
                symbol=pos.symbol,
                side="SELL" if pos.side in ("BUY", "LONG") else "BUY",
                quantity=pos.quantity,
                entry_price=pos.entry_price,
                exit_price=exit_price,
                pnl=pnl,
                pnl_pct=round(pnl / (pos.entry_price * pos.quantity) * 100, 2) if pos.entry_price > 0 else 0,
                strategy="manual",
                pnl_type="REALIZED",
            )
        except Exception as e:
            trade_log.log_error("DB position close", e)


    def update_price(self, symbol: str, price: float):
        if symbol in self.positions:
            self.positions[symbol].current_price = price

    def check_sl_tp(self, symbol: str, price: float) -> tuple:
        """Check if an open position breached its stop-loss or take-profit price.
        
        Returns: (should_exit: bool, exit_reason: str, position: Optional[Position])
        """
        if symbol not in self.positions:
            return False, "No open position", None

        pos = self.positions[symbol]
        pos.current_price = price

        if pos.side in ("BUY", "LONG"):
            if pos.stop_loss > 0 and price <= pos.stop_loss:
                return True, f"STOP_LOSS_HIT (Price: Rs{price} <= SL: Rs{pos.stop_loss})", pos
            if pos.take_profit > 0 and price >= pos.take_profit:
                return True, f"TAKE_PROFIT_HIT (Price: Rs{price} >= TP: Rs{pos.take_profit})", pos
        else:  # Short / Sell
            if pos.stop_loss > 0 and price >= pos.stop_loss:
                return True, f"STOP_LOSS_HIT (Price: Rs{price} >= SL: Rs{pos.stop_loss})", pos
            if pos.take_profit > 0 and price <= pos.take_profit:
                return True, f"TAKE_PROFIT_HIT (Price: Rs{price} <= TP: Rs{pos.take_profit})", pos

        return False, "HOLDING", pos

    def square_off_all(self, exit_prices: Optional[dict] = None, reason: str = "EMERGENCY_SQUARE_OFF") -> list:
        """Close all active open positions immediately."""
        exit_prices = exit_prices or {}
        closed = []
        for symbol in list(self.positions.keys()):
            pos = self.positions[symbol]
            price = exit_prices.get(symbol, pos.current_price or pos.entry_price)
            pnl = self.close_position(symbol, price)
            closed.append({
                "symbol": symbol,
                "quantity": pos.quantity,
                "entry_price": pos.entry_price,
                "exit_price": price,
                "pnl": pnl,
                "reason": reason,
            })
            trade_log.logger.info("Square-off %s @ Rs%s (%s), P&L: Rs%s", symbol, price, reason, pnl)
        return closed

    def save_daily_performance(self, date=None):
        """Persist today's trading performance into the DailyPerformance model."""
        if not self.persist_db:
            return
        try:
            from core.models import DailyPerformance
            now = timezone.now().date() if date is None else date
            total_trades = self.winning_trades + self.losing_trades
            win_rate = round(self.winning_trades / max(1, total_trades) * 100, 1)

            DailyPerformance.objects.update_or_create(
                date=now,
                defaults={
                    "starting_capital": self.capital,
                    "ending_capital": self.current_capital,
                    "total_trades": self.daily_orders,
                    "winning_trades": self.winning_trades,
                    "losing_trades": self.losing_trades,
                    "realized_pnl": self.daily_pnl,
                    "max_drawdown_pct": self.max_drawdown,
                    "win_rate": win_rate,
                },
            )
            trade_log.logger.info("Saved DailyPerformance record for %s", now)
        except Exception as e:
            trade_log.log_error("DailyPerformance save", e)

    def get_portfolio_summary(self) -> dict:
        unrealized = sum(p.unrealized_pnl for p in self.positions.values())
        invested = sum(p.entry_price * p.quantity for p in self.positions.values())
        total_equity = self.capital + self.daily_pnl + unrealized
        available_cash = max(0.0, self.capital + self.daily_pnl - invested)
        total_trades = self.winning_trades + self.losing_trades
        return {
            "initial_capital": self.capital,
            "current_capital": round(total_equity, 2),
            "available_cash": round(available_cash, 2),
            "invested_capital": round(invested, 2),
            "open_positions": len(self.positions),
            "unrealized_pnl": round(unrealized, 2),
            "realized_pnl": round(self.daily_pnl, 2),
            "total_trades_today": self.daily_orders,
            "win_rate": round(self.winning_trades / max(1, total_trades) * 100, 1),
            "max_drawdown_pct": round(self.max_drawdown, 2),
        }

    def reset_daily(self):
        self.save_daily_performance()
        self.daily_orders = 0
        self.daily_pnl = 0.0
        self.winning_trades = 0
        self.losing_trades = 0
        self._order_timestamps.clear()
        self._loss_cooldown_until = None


_risk_manager: Optional[RiskManager] = None


def get_risk_manager() -> RiskManager:
    """Return the global RiskManager singleton, loading positions from DB on first call."""
    global _risk_manager
    if _risk_manager is None:
        _risk_manager = RiskManager()
        _risk_manager.load_from_db()
    return _risk_manager
