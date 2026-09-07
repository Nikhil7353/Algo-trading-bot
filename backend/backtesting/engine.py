from datetime import datetime
from typing import Optional

import pandas as pd
import numpy as np

from core.config import get_settings
from core.logger import trade_log
from strategies.engine import StrategyEngine
from risk.manager import RiskManager


class BacktestEngine:
    def __init__(self, strategy_names=None, capital=None):
        self.settings = get_settings()
        self.capital = capital or self.settings.bt_initial_capital
        self.engine = StrategyEngine(strategy_names)
        # self.rm is created fresh inside run() — no singleton needed at init time

    def run(self, symbol: str, data: pd.DataFrame) -> dict:
        if data.empty or len(data) < 50:
            return {"error": "Insufficient data"}

        trades = []
        self.rm = RiskManager(self.capital, persist_db=False)
        entry_price = 0
        entry_date = None
        entry_action = None
        current_day = None

        warmup = max(s.required_history_bars() for s in self.engine.strategies)

        for i in range(warmup, len(data)):
            # Pass a slice (view) instead of a growing copy — strategies read but don't mutate
            window = data.iloc[: i + 1]
            current = data.iloc[i]
            price = float(current["close"])
            high_price = float(current.get("high", price))
            low_price = float(current.get("low", price))
            bar_date = pd.Timestamp(current["date"]).to_pydatetime()
            bar_day = bar_date.date()

            if current_day and bar_day != current_day:
                self.rm.reset_daily()
            current_day = bar_day

            self.rm.update_price(symbol, price)

            # 1. Check if open position breached Stop-Loss or Take-Profit within this bar
            if symbol in self.rm.positions:
                pos = self.rm.positions[symbol]
                hit_sl = low_price <= pos.stop_loss if pos.stop_loss > 0 else False
                hit_tp = high_price >= pos.take_profit if pos.take_profit > 0 else False

                if hit_sl or hit_tp:
                    exit_price = pos.stop_loss if hit_sl else pos.take_profit
                    # Apply slippage: SL fills below price (adverse), TP fills above (adverse for exit)
                    effective_exit = (
                        exit_price * (1 - self.settings.slippage_pct / 100) if hit_sl
                        else exit_price * (1 + self.settings.slippage_pct / 100)
                    )
                    raw_pnl = (effective_exit - pos.entry_price) * pos.quantity if pos.side == "BUY" else (pos.entry_price - effective_exit) * pos.quantity
                    fees = (pos.entry_price + effective_exit) * pos.quantity * (self.settings.commission_pct / 100)
                    net_pnl = raw_pnl - fees

                    self.rm.close_position(symbol, effective_exit, now=bar_date)
                    trades.append({
                        "entry_date": str(entry_date)[:10],
                        "exit_date": str(current["date"])[:10],
                        "side": entry_action,
                        "entry_price": entry_price,
                        "exit_price": round(effective_exit, 2),
                        "qty": pos.quantity,
                        "pnl": round(net_pnl, 2),
                        "pnl_pct": round(net_pnl / (entry_price * pos.quantity) * 100, 2),
                        "strategy": "STOP_LOSS" if hit_sl else "TAKE_PROFIT",
                    })
                    continue

            # 2. Strategy signals analysis (silent=True suppresses per-bar log spam)
            signals = self.engine.analyze(symbol, window, silent=True)

            if signals:
                sig = signals[0]

                if sig.action == "BUY" and symbol not in self.rm.positions:
                    # Apply buy slippage
                    exec_price = price * (1 + self.settings.slippage_pct / 100)
                    approved, qty, reason = self.rm.validate_signal(symbol, "BUY", exec_price, now=bar_date)
                    if approved:
                        self.rm.register_order(now=bar_date)
                        self.rm.open_position(symbol, "BUY", qty, exec_price, now=bar_date)
                        entry_price = exec_price
                        entry_date = current["date"]
                        entry_action = "BUY"

                elif sig.action == "SELL" and symbol in self.rm.positions:
                    pos = self.rm.positions[symbol]
                    exec_price = price * (1 - self.settings.slippage_pct / 100)
                    raw_pnl = self.rm.close_position(symbol, exec_price, now=bar_date)
                    if raw_pnl is not None:
                        fees = (pos.entry_price + exec_price) * pos.quantity * (self.settings.commission_pct / 100)
                        net_pnl = raw_pnl - fees
                        trades.append({
                            "entry_date": str(entry_date)[:10],
                            "exit_date": str(current["date"])[:10],
                            "side": entry_action,
                            "entry_price": round(entry_price, 2),
                            "exit_price": round(exec_price, 2),
                            "qty": pos.quantity,
                            "pnl": round(net_pnl, 2),
                            "pnl_pct": round(net_pnl / (entry_price * pos.quantity) * 100, 2),
                            "strategy": sig.strategy,
                        })

        for symbol_key in list(self.rm.positions.keys()):
            pos = self.rm.positions[symbol_key]
            last_price = float(data["close"].iloc[-1])
            bar_date = pd.Timestamp(data["date"].iloc[-1]).to_pydatetime()
            pnl = self.rm.close_position(symbol_key, last_price, now=bar_date)
            if pnl is not None:
                fees = (pos.entry_price + last_price) * pos.quantity * (self.settings.commission_pct / 100)
                net_pnl = pnl - fees
                trades.append({
                    "entry_date": str(pos.entry_time)[:10],
                    "exit_date": str(data["date"].iloc[-1])[:10],
                    "side": pos.side,
                    "entry_price": round(pos.entry_price, 2),
                    "exit_price": round(last_price, 2),
                    "qty": pos.quantity,
                    "pnl": round(net_pnl, 2),
                    "pnl_pct": round(net_pnl / (pos.entry_price * pos.quantity) * 100, 2),
                    "strategy": "EOD_CLOSE",
                })

        wins = len([t for t in trades if t["pnl"] > 0])
        losses = len([t for t in trades if t["pnl"] <= 0])
        total_pnl = sum(t["pnl"] for t in trades)

        equity_curve = self._build_equity_curve(trades)

        return {
            "symbol": symbol,
            "period": f"{str(data['date'].iloc[0])[:10]} to {str(data['date'].iloc[-1])[:10]}",
            "initial_capital": self.capital,
            "final_capital": round(self.capital + total_pnl, 2),
            "total_trades": len(trades),
            "wins": wins,
            "losses": losses,
            "win_rate": round(wins / max(1, len(trades)) * 100, 1),
            "total_pnl": round(total_pnl, 2),
            "total_return_pct": round(total_pnl / self.capital * 100, 2),
            "max_drawdown_pct": round(self.rm.max_drawdown, 2),
            "trades": trades,
            "equity_curve": equity_curve,
        }

    def _build_equity_curve(self, trades):
        curve = [{"date": "start", "equity": self.capital}]
        running = self.capital
        for t in trades:
            running += t["pnl"]
            curve.append({"date": t["exit_date"], "equity": round(running, 2)})
        return curve

    def run_watchlist(self, fetcher) -> list:
        results = []
        for symbol in self.settings.watchlist:
            data = fetcher.fetch_historical(symbol, days=504)
            if not data.empty:
                result = self.run(symbol, data)
                results.append(result)
                trade_log.logger.info(
                    f"Backtest {symbol}: {result['total_trades']} trades, "
                    f"P&L: Rs{result['total_pnl']}, Win: {result['win_rate']}%"
                )
        return results
