from datetime import datetime
from typing import List
import pandas as pd
import numpy as np

from strategies.base import BaseStrategy, Signal


class SupertrendStrategy(BaseStrategy):
    """
    Supertrend Momentum Strategy (Standard 10, 3)
    Calculates Average True Range (ATR) and dynamically shifts Upper/Lower bands.
    Generates BUY when price crosses above Supertrend line and SELL when price drops below.
    """
    name = "supertrend"
    description = "Supertrend (10, 3) ATR Momentum Strategy"

    def __init__(self, atr_period: int = 10, multiplier: float = 3.0, **kwargs):
        super().__init__(**kwargs)
        self.atr_period = atr_period
        self.multiplier = multiplier

    def required_history_bars(self) -> int:
        return self.atr_period + 10

    def _calculate_atr(self, df: pd.DataFrame) -> pd.Series:
        high = df["high"]
        low = df["low"]
        close = df["close"].shift(1)

        tr1 = high - low
        tr2 = (high - close).abs()
        tr3 = (low - close).abs()

        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        atr = tr.rolling(window=self.atr_period, min_periods=self.atr_period).mean()
        return atr

    def _calculate_supertrend(self, df: pd.DataFrame):
        hl2 = (df["high"] + df["low"]) / 2
        atr = self._calculate_atr(df)

        upper_band = hl2 + (self.multiplier * atr)
        lower_band = hl2 - (self.multiplier * atr)

        supertrend = pd.Series(index=df.index, dtype=float)
        direction = pd.Series(index=df.index, dtype=int)

        in_uptrend = True

        for i in range(len(df)):
            if i < self.atr_period:
                supertrend.iloc[i] = np.nan
                direction.iloc[i] = 1
                continue

            curr_close = df["close"].iloc[i]
            prev_close = df["close"].iloc[i - 1]
            prev_upper = upper_band.iloc[i - 1]
            prev_lower = lower_band.iloc[i - 1]
            curr_upper = upper_band.iloc[i]
            curr_lower = lower_band.iloc[i]

            # Adjust bands to not widen against trend
            if curr_lower < prev_lower and prev_close > prev_lower:
                curr_lower = prev_lower
                lower_band.iloc[i] = curr_lower

            if curr_upper > prev_upper and prev_close < prev_upper:
                curr_upper = prev_upper
                upper_band.iloc[i] = curr_upper

            if in_uptrend:
                if curr_close < curr_lower:
                    in_uptrend = False
                    supertrend.iloc[i] = curr_upper
                    direction.iloc[i] = -1
                else:
                    supertrend.iloc[i] = curr_lower
                    direction.iloc[i] = 1
            else:
                if curr_close > curr_upper:
                    in_uptrend = True
                    supertrend.iloc[i] = curr_lower
                    direction.iloc[i] = 1
                else:
                    supertrend.iloc[i] = curr_upper
                    direction.iloc[i] = -1

        return supertrend, direction

    def generate_signals(self, data: pd.DataFrame) -> List[Signal]:
        if not self.validate_data(data):
            return []

        df = data.copy()
        supertrend, direction = self._calculate_supertrend(df)
        df["supertrend"] = supertrend
        df["direction"] = direction

        symbol = df["symbol"].iloc[-1] if "symbol" in df.columns else ""
        signals = []

        if len(df) >= 2:
            curr_dir = df["direction"].iloc[-1]
            prev_dir = df["direction"].iloc[-2]
            last = df.iloc[-1]
            price = float(last["close"])

            if curr_dir == 1 and prev_dir == -1:
                signals.append(
                    Signal(
                        symbol=symbol,
                        strategy=self.name,
                        action="BUY",
                        price=price,
                        timestamp=datetime.now(),
                        strength=0.85,
                        metadata={"supertrend": round(float(last["supertrend"]), 2), "direction": 1},
                    )
                )
            elif curr_dir == -1 and prev_dir == 1:
                signals.append(
                    Signal(
                        symbol=symbol,
                        strategy=self.name,
                        action="SELL",
                        price=price,
                        timestamp=datetime.now(),
                        strength=0.85,
                        metadata={"supertrend": round(float(last["supertrend"]), 2), "direction": -1},
                    )
                )

        return signals
