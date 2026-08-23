from datetime import datetime
from typing import List

import pandas as pd

from strategies.base import BaseStrategy, Signal, calculate_rsi


class RsiReversalStrategy(BaseStrategy):
    name = "rsi_reversal"
    description = "RSI Oversold/Overbought Reversal with Volume"

    def __init__(self, rsi_period=14, oversold=30, overbought=70, volume_mult=1.5, **kwargs):
        super().__init__(**kwargs)
        self.rsi_period = rsi_period
        self.oversold = oversold
        self.overbought = overbought
        self.volume_mult = volume_mult

    def required_history_bars(self) -> int:
        return self.rsi_period + 25

    def generate_signals(self, data: pd.DataFrame) -> List[Signal]:
        if not self.validate_data(data):
            return []

        df = data.copy()
        df["rsi"] = calculate_rsi(df["close"], self.rsi_period)
        df["vol_sma"] = df["volume"].rolling(window=20).mean()

        symbol = df["symbol"].iloc[-1] if "symbol" in df.columns else ""
        last = df.iloc[-1]
        prev = df.iloc[-2]
        signals = []

        if prev["rsi"] < self.oversold and last["rsi"] >= self.oversold and last["volume"] > last["vol_sma"] * self.volume_mult:
            strength = min(1.0, (self.overbought - last["rsi"]) / 40 + 0.4)
            signals.append(Signal(
                symbol=symbol, strategy=self.name, action="BUY",
                price=float(last["close"]), timestamp=datetime.now(),
                strength=round(strength, 3),
                metadata={"rsi": float(round(last["rsi"], 2)), "vol_ratio": float(round(last["volume"] / last["vol_sma"], 2))},
            ))
        elif prev["rsi"] > self.overbought and last["rsi"] <= self.overbought:
            strength = min(1.0, (last["rsi"] - self.oversold) / 40 + 0.4)
            signals.append(Signal(
                symbol=symbol, strategy=self.name, action="SELL",
                price=float(last["close"]), timestamp=datetime.now(),
                strength=round(strength, 3),
                metadata={"rsi": float(round(last["rsi"], 2))},
            ))

        return signals
