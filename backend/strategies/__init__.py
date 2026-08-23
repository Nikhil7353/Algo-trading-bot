from .base import BaseStrategy, Signal
from .ema_crossover import EmaCrossoverStrategy
from .rsi_reversal import RsiReversalStrategy
from .bollinger_breakout import BollingerBreakoutStrategy
from .supertrend import SupertrendStrategy
from .vwap import VWAPStrategy

STRATEGY_REGISTRY = {
    "ema_crossover": EmaCrossoverStrategy,
    "rsi_reversal": RsiReversalStrategy,
    "bollinger_breakout": BollingerBreakoutStrategy,
    "supertrend": SupertrendStrategy,
    "vwap": VWAPStrategy,
}


def get_strategy(name: str, **kwargs) -> BaseStrategy | None:
    cls = STRATEGY_REGISTRY.get(name)
    if cls:
        return cls(**kwargs)
    return None


__all__ = [
    "BaseStrategy",
    "Signal",
    "EmaCrossoverStrategy",
    "RsiReversalStrategy",
    "BollingerBreakoutStrategy",
    "SupertrendStrategy",
    "VWAPStrategy",
    "STRATEGY_REGISTRY",
    "get_strategy",
]
