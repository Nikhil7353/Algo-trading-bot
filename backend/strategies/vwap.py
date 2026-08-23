from datetime import datetime
from typing import List
import pandas as pd
import numpy as np

from strategies.base import BaseStrategy, Signal, calculate_rsi


class VWAPStrategy(BaseStrategy):
    """
    VWAP (Volume-Weighted Average Price) Momentum Strategy
    Combines intraday volume weighted average price with RSI momentum confirmation.
    Generates BUY when price breaks above VWAP with rising momentum (RSI > 50).
    Generates SELL when price breaks below VWAP (RSI < 50).
    """
    name = "vwap"
    description = "VWAP + RSI Momentum Breakout"

    def __init__(self, rsi_period: int = 14, **kwargs):
        super().__init__(**kwargs)
        self.rsi_period = rsi_period

    def required_history_bars(self) -> int:
        return self.rsi_period + 10

    def _calculate_vwap(self, df: pd.DataFrame) -> pd.Series:
        typical_price = (df["high"] + df["low"] + df["close"]) / 3
        volume = df["volume"].replace(0, np.nan).fillna(1)
        cum_vol_price = (typical_price * volume).cumsum()
        cum_volume = volume.cumsum()
        return cum_vol_price / cum_volume

    def generate_signals(self, data: pd.DataFrame) -> List[Signal]:
        if not self.validate_data(data):
            return []

        df = data.copy()
        df["vwap"] = self._calculate_vwap(df)
        df["rsi"] = calculate_rsi(df["close"], self.rsi_period)

        symbol = df["symbol"].iloc[-1] if "symbol" in df.columns else ""
        signals = []

        if len(df) >= 2:
            last = df.iloc[-1]
            prev = df.iloc[-2]

            curr_close = last["close"]
            prev_close = prev["close"]
            curr_vwap = last["vwap"]
            prev_vwap = prev["vwap"]
            curr_rsi = last["rsi"]

            if not pd.isna(curr_vwap) and not pd.isna(curr_rsi):
                price = float(curr_close)

                # Bullish: Price crosses above VWAP and RSI > 50
                if prev_close <= prev_vwap and curr_close > curr_vwap and curr_rsi > 50:
                    signals.append(
                        Signal(
                            symbol=symbol,
                            strategy=self.name,
                            action="BUY",
                            price=price,
                            timestamp=datetime.now(),
                            strength=0.80,
                            metadata={"vwap": round(float(curr_vwap), 2), "rsi": round(float(curr_rsi), 2)},
                        )
                    )
                # Bearish: Price crosses below VWAP and RSI < 50
                elif prev_close >= prev_vwap and curr_close < curr_vwap and curr_rsi < 50:
                    signals.append(
                        Signal(
                            symbol=symbol,
                            strategy=self.name,
                            action="SELL",
                            price=price,
                            timestamp=datetime.now(),
                            strength=0.80,
                            metadata={"vwap": round(float(curr_vwap), 2), "rsi": round(float(curr_rsi), 2)},
                        )
                    )

        return signals
