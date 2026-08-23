from typing import Dict, List, Type

from strategies.base import BaseStrategy, Signal
from strategies.ema_crossover import EmaCrossoverStrategy
from strategies.rsi_reversal import RsiReversalStrategy
from strategies.bollinger_breakout import BollingerBreakoutStrategy
from strategies.supertrend import SupertrendStrategy
from strategies.vwap import VWAPStrategy
from core.config import get_settings
from core.logger import trade_log

import pandas as pd

STRATEGY_REGISTRY: Dict[str, Type[BaseStrategy]] = {
    "ema_crossover": EmaCrossoverStrategy,
    "rsi_reversal": RsiReversalStrategy,
    "bollinger_breakout": BollingerBreakoutStrategy,
    "supertrend": SupertrendStrategy,
    "vwap": VWAPStrategy,
}


class StrategyEngine:
    def __init__(self, strategy_names: List[str] = None):
        settings = get_settings()
        if strategy_names is None:
            strategy_names = settings.active_strategies

        self.strategies: List[BaseStrategy] = []
        for name in strategy_names:
            if name in STRATEGY_REGISTRY:
                params = settings.get_strategy_params(name)
                self.strategies.append(STRATEGY_REGISTRY[name](**params))
                trade_log.logger.info(f"Loaded strategy: {name}")
            else:
                trade_log.log_risk(f"Unknown strategy: {name}")

    def analyze(self, symbol: str, data: pd.DataFrame) -> List[Signal]:
        all_signals = []
        for strategy in self.strategies:
            try:
                signals = strategy.generate_signals(data)
                for sig in signals:
                    trade_log.log_signal(sig.strategy, sig.symbol, sig.action, sig.price, sig.metadata)
                all_signals.extend(signals)
            except Exception as e:
                trade_log.log_error(f"Strategy {strategy.name}", e)
        return all_signals

    def get_available(self) -> List[str]:
        return list(STRATEGY_REGISTRY.keys())

    def register(self, name: str, cls: Type[BaseStrategy]):
        STRATEGY_REGISTRY[name] = cls
