import yaml
from pathlib import Path
from dotenv import load_dotenv
import os

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")


class Settings:
    def __init__(self):
        config_path = BASE_DIR / "config" / "settings.yaml"
        with open(config_path, "r") as f:
            self._data = yaml.safe_load(f) or {}

        self.mode = os.getenv("TRADING_MODE", self._data.get("mode", "paper"))

        self.angel_api_key = os.getenv("ANGELONE_API_KEY", "")
        self.angel_client_id = os.getenv("ANGELONE_CLIENT_ID", "")
        self.angel_password = os.getenv("ANGELONE_PASSWORD", "")
        self.angel_totp_secret = os.getenv("ANGELONE_TOTP_SECRET", "")

        trading = self._data.get("trading", {})
        self.exchanges = trading.get("exchanges", ["NSE"])
        self.segments = trading.get("segments", ["EQ"])
        self.market_start = trading.get("market_hours", {}).get("start", "09:15")
        self.market_end = trading.get("market_hours", {}).get("end", "15:30")

        risk = self._data.get("risk", {})
        self.capital = risk.get("capital", 25000)
        self.max_position_pct = risk.get("max_position_pct", 5.0)
        self.max_daily_loss_pct = risk.get("max_daily_loss_pct", 2.0)
        self.max_open_positions = risk.get("max_open_positions", 3)
        self.stop_loss_pct = risk.get("stop_loss_pct", 2.0)
        self.take_profit_pct = risk.get("take_profit_pct", 4.0)
        self.trailing_stop_loss_pct = risk.get("trailing_stop_loss_pct", 1.0)
        self.max_orders_per_minute = risk.get("max_orders_per_minute", 5)
        self.max_orders_per_day = risk.get("max_orders_per_day", 50)
        self.cooldown_after_loss_sec = risk.get("cooldown_after_loss_sec", 300)

        self.active_strategies = self._data.get("strategies", {}).get("active", ["ema_crossover"])
        self.watchlist = self._data.get("strategies", {}).get("watchlist", [])

        bt = self._data.get("backtesting", {})
        self.bt_initial_capital = bt.get("initial_capital", 25000)
        self.commission_pct = bt.get("commission_pct", 0.03)
        self.slippage_pct = bt.get("slippage_pct", 0.05)

        self.strategy_params = {
            "ema_crossover": self._data.get("ema_crossover", {}),
            "rsi_reversal": self._data.get("rsi_reversal", {}),
            "bollinger_breakout": self._data.get("bollinger_breakout", {}),
        }

    def get_strategy_params(self, name: str) -> dict:
        return self.strategy_params.get(name, {})


_settings = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
