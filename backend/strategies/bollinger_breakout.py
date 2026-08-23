from datetime import datetime
from typing import List

import pandas as pd

from strategies.base import BaseStrategy, Signal


class BollingerBreakoutStrategy(BaseStrategy):
    name = "bollinger_breakout"
    description = "Bollinger Band Breakout"

    def __init__(self, period=20, std_dev=2.0, **kwargs):
        super().__init__(**kwargs)
        self.period = period
        self.std_dev = std_dev

    def required_history_bars(self) -> int:
        return self.period + 10

    def generate_signals(self, data: pd.DataFrame) -> List[Signal]:
        if not self.validate_data(data):
            return []

        df = data.copy()
        df["sma"] = df["close"].rolling(window=self.period).mean()
        df["std"] = df["close"].rolling(window=self.period).std()
        df["upper"] = df["sma"] + (self.std_dev * df["std"])
        df["lower"] = df["sma"] - (self.std_dev * df["std"])

        symbol = df["symbol"].iloc[-1] if "symbol" in df.columns else ""
        last = df.iloc[-1]
        prev = df.iloc[-2]
        signals = []

        if last["close"] > last["upper"] and prev["close"] <= prev["upper"]:
            width = float((last["upper"] - last["lower"]) / last["sma"])
            strength = min(1.0, width / 0.1)
            signals.append(Signal(
                symbol=symbol, strategy=self.name, action="BUY",
                price=float(last["close"]), timestamp=datetime.now(),
                strength=round(strength, 3),
                metadata={"upper": round(float(last["upper"]), 2), "bb_width": round(width, 4)},
            ))
        elif last["close"] < last["lower"] or (prev["close"] > prev["sma"] and last["close"] < last["sma"]):
            signals.append(Signal(
                symbol=symbol, strategy=self.name, action="SELL",
                price=float(last["close"]), timestamp=datetime.now(),
                strength=0.6,
                metadata={"lower": round(float(last["lower"]), 2), "sma": round(float(last["sma"]), 2)},
            ))

        return signals
