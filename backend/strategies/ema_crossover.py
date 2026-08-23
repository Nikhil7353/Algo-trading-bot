from datetime import datetime
from typing import List

import pandas as pd

from strategies.base import BaseStrategy, Signal, calculate_rsi, calculate_ema


class EmaCrossoverStrategy(BaseStrategy):
    name = "ema_crossover"
    description = "EMA 9/21 Crossover with RSI filter"

    def __init__(self, fast_period=9, slow_period=21, rsi_period=14,
                 rsi_oversold=35, rsi_overbought=70, **kwargs):
        super().__init__(**kwargs)
        self.fast_period = fast_period
        self.slow_period = slow_period
        self.rsi_period = rsi_period
        self.rsi_oversold = rsi_oversold
        self.rsi_overbought = rsi_overbought

    def required_history_bars(self) -> int:
        return self.slow_period + self.rsi_period + 10

    def generate_signals(self, data: pd.DataFrame) -> List[Signal]:
        if not self.validate_data(data):
            return []

        df = data.copy()
        df["ema_fast"] = calculate_ema(df["close"], self.fast_period)
        df["ema_slow"] = calculate_ema(df["close"], self.slow_period)
        df["rsi"] = calculate_rsi(df["close"], self.rsi_period)

        df["cross_up"] = (df["ema_fast"] > df["ema_slow"]) & (df["ema_fast"].shift(1) <= df["ema_slow"].shift(1))
        df["cross_down"] = (df["ema_fast"] < df["ema_slow"]) & (df["ema_fast"].shift(1) >= df["ema_slow"].shift(1))

        symbol = df["symbol"].iloc[-1] if "symbol" in df.columns else ""
        last = df.iloc[-1]
        signals = []

        if last["cross_up"] and last["rsi"] < self.rsi_overbought:
            strength = min(1.0, (self.rsi_overbought - last["rsi"]) / 30 + 0.3)
            signals.append(Signal(
                symbol=symbol, strategy=self.name, action="BUY",
                price=float(last["close"]), timestamp=datetime.now(),
                strength=round(strength, 3),
                metadata={"ema_fast": float(round(last["ema_fast"], 2)), "ema_slow": float(round(last["ema_slow"], 2)), "rsi": float(round(last["rsi"], 2))},
            ))
        elif last["cross_down"] and last["rsi"] > self.rsi_oversold:
            strength = min(1.0, (last["rsi"] - self.rsi_oversold) / 30 + 0.3)
            signals.append(Signal(
                symbol=symbol, strategy=self.name, action="SELL",
                price=float(last["close"]), timestamp=datetime.now(),
                strength=round(strength, 3),
                metadata={"ema_fast": float(round(last["ema_fast"], 2)), "ema_slow": float(round(last["ema_slow"], 2)), "rsi": float(round(last["rsi"], 2))},
            ))

        return signals
