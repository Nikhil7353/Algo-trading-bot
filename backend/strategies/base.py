from abc import ABC, abstractmethod
from typing import List

import pandas as pd

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any


@dataclass
class Signal:
    symbol: str
    strategy: str
    action: str  # BUY | SELL | HOLD
    price: float
    timestamp: datetime
    strength: float = 0.0
    metadata: Optional[Dict[str, Any]] = None


def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Calculate standard Relative Strength Index (RSI) using Wilder's Exponential Smoothing."""
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)

    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, 1e-10)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return rsi


def calculate_ema(series: pd.Series, period: int) -> pd.Series:
    """Calculate Exponential Moving Average (EMA)."""
    return series.ewm(span=period, adjust=False).mean()


class BaseStrategy(ABC):
    name: str = "base"
    description: str = ""

    def __init__(self, **kwargs):
        self.params = kwargs

    @abstractmethod
    def generate_signals(self, data: pd.DataFrame) -> List[Signal]:
        pass

    @abstractmethod
    def required_history_bars(self) -> int:
        pass

    def validate_data(self, data: pd.DataFrame) -> bool:
        required = {"date", "open", "high", "low", "close", "volume"}
        return required.issubset(data.columns) and len(data) >= self.required_history_bars()
