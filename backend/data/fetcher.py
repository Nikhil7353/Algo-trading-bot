import json
import os
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, Tuple

import numpy as np
import pandas as pd

from core.config import get_settings
from core.logger import trade_log

BASE_DIR = Path(__file__).resolve().parent.parent.parent
SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
CACHE_EXPIRY_HOURS = 24

# Fallback common NSE Instrument Tokens for offline safety
DEFAULT_NSE_TOKENS: Dict[str, str] = {
    "RELIANCE": "2885",
    "TCS": "11536",
    "INFY": "1594",
    "HDFCBANK": "1333",
    "ICICIBANK": "4963",
    "SBIN": "3045",
    "BHARTIARTL": "10604",
    "ITC": "1660",
    "KOTAKBANK": "1922",
    "LT": "11483",
    "TATAMOTORS": "3456",
    "TATASTEEL": "3499",
    "AXISBANK": "5900",
    "MARUTI": "10999",
    "SUNPHARMA": "3351",
    "WIPRO": "3787",
    "HCLTECH": "7229",
    "NTPC": "11630",
    "ONGC": "2475",
    "POWERGRID": "14977",
    "BAJFINANCE": "317",
    "BAJAJFINSV": "16675",
    "TITAN": "3506",
    "ASIANPAINT": "236",
    "HINDUNILVR": "1394",
}


class InstrumentTokenMaster:
    """
    Downloads, caches, and indexes Angel One's full instrument master (OpenAPIScripMaster.json).
    Enables dynamic resolution of any NSE or BSE ticker symbol to its numeric instrument token.
    """
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, cache_dir: Optional[Path] = None):
        if self._initialized:
            return
        self._initialized = True
        self.cache_path = (cache_dir or (BASE_DIR / "data")) / "OpenAPIScripMaster.json"
        self._symbol_exchange_map: Dict[Tuple[str, str], str] = {}
        self._symbol_map: Dict[str, str] = dict(DEFAULT_NSE_TOKENS)
        self.load_instruments()

    def load_instruments(self, force_download: bool = False):
        """Load instrument tokens from local cache or download fresh if expired/missing."""
        needs_download = force_download or not self.cache_path.exists()
        if not needs_download and self.cache_path.exists():
            try:
                file_age = time.time() - os.path.getmtime(self.cache_path)
                if file_age > (CACHE_EXPIRY_HOURS * 3600):
                    needs_download = True
            except OSError:
                needs_download = True

        if needs_download:
            self._download_scrip_master()

        if self.cache_path.exists():
            self._parse_cache_file()
        else:
            trade_log.logger.warning("Using fallback static NSE instrument token map")
            self._symbol_map.update(DEFAULT_NSE_TOKENS)

    def _download_scrip_master(self):
        """Download fresh OpenAPIScripMaster.json from Angel One."""
        try:
            trade_log.logger.info("Downloading latest Angel One Scrip Master JSON...")
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            req = urllib.request.Request(
                SCRIP_MASTER_URL,
                headers={"User-Agent": "StockBot/2.0 (Mozilla/5.0)"},
            )
            with urllib.request.urlopen(req, timeout=25) as response:
                content = response.read()
                with open(self.cache_path, "wb") as f:
                    f.write(content)
            trade_log.logger.info("Successfully cached OpenAPIScripMaster.json (%d bytes)", len(content))
        except Exception as e:
            trade_log.logger.warning("Failed to download Angel One Scrip Master: %s. Using local cache/defaults.", e)

    def _parse_cache_file(self):
        """Index symbols for fast O(1) resolution by symbol and exchange."""
        try:
            with open(self.cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            count = 0
            for item in data:
                token = str(item.get("token", "")).strip()
                name = str(item.get("name", "")).upper().strip()
                raw_symbol = str(item.get("symbol", "")).upper().strip()
                exch = str(item.get("exch_seg", "")).upper().strip()

                if not token:
                    continue

                clean_sym = raw_symbol.replace("-EQ", "").replace(".NS", "").replace(".BO", "").strip()

                # Map exact (symbol, exchange) and (name, exchange)
                if clean_sym and exch:
                    self._symbol_exchange_map[(clean_sym, exch)] = token
                if name and exch:
                    self._symbol_exchange_map[(name, exch)] = token

                # Default fallback map (prefer NSE equity over BSE)
                if exch == "NSE" and (raw_symbol.endswith("-EQ") or item.get("instrumenttype") == ""):
                    if clean_sym:
                        self._symbol_map[clean_sym] = token
                    if name:
                        self._symbol_map[name] = token
                elif clean_sym not in self._symbol_map:
                    self._symbol_map[clean_sym] = token
                    if name:
                        self._symbol_map[name] = token

                count += 1

            trade_log.logger.info("Indexed %d instruments in Angel Token Master", count)
        except Exception as e:
            trade_log.log_error("Parse Scrip Master", e)

    def resolve_token(self, symbol: str, exchange: str = "NSE") -> str:
        """Resolve any stock symbol to its numeric Angel One instrument token."""
        clean = symbol.upper().replace(".NS", "").replace(".BO", "").replace("-EQ", "").strip()
        exch = exchange.upper().strip()

        # 1. Direct match with exchange
        if (clean, exch) in self._symbol_exchange_map:
            return self._symbol_exchange_map[(clean, exch)]

        # 2. General symbol match
        if clean in self._symbol_map:
            return self._symbol_map[clean]

        # 3. Fallback static map
        if clean in DEFAULT_NSE_TOKENS:
            return DEFAULT_NSE_TOKENS[clean]

        return clean


class DataFetcher:
    def __init__(self):
        self.settings = get_settings()
        self._client = None
        self._feed_token = None
        self.token_master = InstrumentTokenMaster()

        if self.settings.mode == "live":
            self._connect_angel()

    def get_token(self, symbol: str, exchange: str = "NSE") -> str:
        """Resolve an NSE/BSE trading symbol to its Angel One instrument token."""
        return self.token_master.resolve_token(symbol, exchange)

    def _connect_angel(self):
        try:
            from SmartApi import SmartConnect
            import pyotp

            if not self.settings.angel_api_key:
                trade_log.logger.warning("Angel One API key not configured")
                return

            self._client = SmartConnect(self.settings.angel_api_key)
            totp = pyotp.TOTP(self.settings.angel_totp_secret).now()
            data = self._client.generateSession(
                self.settings.angel_client_id,
                self.settings.angel_password,
                totp,
            )
            if data.get("status"):
                self._feed_token = self._client.getfeedToken()
                trade_log.logger.info("Connected to Angel One SmartAPI")
            else:
                trade_log.log_error("Angel Auth", Exception(data.get("message", "Failed")))
        except ImportError:
            trade_log.log_error("Angel", ImportError("pip install smartapi-python pyotp websocket-client"))
        except Exception as e:
            trade_log.log_error("Angel Connection", e)

    def fetch_historical(self, symbol: str, exchange: str = "NSE", interval: str = "day", days: int = 504) -> pd.DataFrame:
        clean_symbol = symbol.upper().replace(".NS", "").replace(".BO", "").strip()

        # If live mode and client is connected, try Angel One first
        if self.settings.mode == "live" and self._client is not None:
            df = self._fetch_angel(clean_symbol, exchange, interval, days)
            if not df.empty:
                return df

        # Default / Paper / Backtesting: fetch real historical data via yfinance
        df = self._fetch_yfinance(clean_symbol, days=days, interval=interval)
        if not df.empty:
            return df

        # Fallback to simulated data if network/yfinance is completely unavailable
        trade_log.logger.warning("Using synthetic data fallback for %s", clean_symbol)
        return self._generate_sample(clean_symbol, days)

    def _fetch_yfinance(self, symbol: str, days: int = 504, interval: str = "day") -> pd.DataFrame:
        try:
            import yfinance as yf

            # Map interval to yfinance format
            yf_interval_map = {
                "day": "1d",
                "1d": "1d",
                "1h": "1h",
                "5m": "5m",
                "15m": "15m",
                "1m": "1m",
            }
            yf_interval = yf_interval_map.get(interval, "1d")
            ticker_symbol = f"{symbol}.NS" if not symbol.endswith((".NS", ".BO")) else symbol

            # For intraday (1m, 5m), yfinance max period is 60d
            period = f"{days}d" if yf_interval == "1d" else "60d"

            ticker = yf.Ticker(ticker_symbol)
            df = ticker.history(period=period, interval=yf_interval)

            if df is None or df.empty:
                return pd.DataFrame()

            df = df.reset_index()
            # Standardize date column
            date_col = "Date" if "Date" in df.columns else "Datetime" if "Datetime" in df.columns else df.columns[0]
            df = df.rename(columns={
                date_col: "date",
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Volume": "volume",
            })

            # Ensure proper types and clean any incomplete / NaN rows
            df = df.dropna(subset=["open", "high", "low", "close"])
            df["date"] = pd.to_datetime(df["date"]).dt.tz_localize(None)
            df["symbol"] = symbol
            for col in ["open", "high", "low", "close"]:
                df[col] = df[col].astype(float)
            df["volume"] = df["volume"].fillna(0).astype(int)

            return df[["date", "open", "high", "low", "close", "volume", "symbol"]]
        except Exception as e:
            trade_log.logger.debug("yfinance fetch failed for %s: %s", symbol, e)
            return pd.DataFrame()

    def _fetch_angel(self, symbol: str, exchange: str, interval: str, days: int) -> pd.DataFrame:
        try:
            token = self.get_token(symbol, exchange)
            interval_map = {
                "day": "ONE_DAY",
                "1d": "ONE_DAY",
                "1h": "ONE_HOUR",
                "5m": "FIVE_MINUTE",
                "1m": "ONE_MINUTE",
            }
            params = {
                "exchange": exchange,
                "symboltoken": token,
                "interval": interval_map.get(interval, "ONE_DAY"),
                "fromdate": (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d 09:15"),
                "todate": datetime.now().strftime("%Y-%m-%d 15:30"),
            }
            data = self._client.getCandleData(params)
            if data and data.get("data"):
                df = pd.DataFrame(
                    data["data"],
                    columns=["date", "open", "high", "low", "close", "volume"],
                )
                df = df.dropna(subset=["open", "high", "low", "close"])
                df["date"] = pd.to_datetime(df["date"])
                df["symbol"] = symbol
                for col in ["open", "high", "low", "close"]:
                    df[col] = df[col].astype(float)
                df["volume"] = df["volume"].fillna(0).astype(int)
                return df
        except Exception as e:
            trade_log.log_error(f"Angel Historical for {symbol}", e)
        return pd.DataFrame()

    def fetch_live_price(
        self,
        symbol: str,
        exchange: str = "NSE",
        allow_slow_fallback: bool = True,
    ) -> Optional[float]:
        clean_symbol = symbol.upper().replace(".NS", "").replace(".BO", "").strip()

        # If live mode and connected, use Angel One LTP
        if self.settings.mode == "live" and self._client is not None:
            try:
                token = self.get_token(clean_symbol, exchange)
                data = self._client.ltpData(exchange, clean_symbol, token)
                if data and data.get("data"):
                    return float(data["data"]["ltp"])
            except Exception as e:
                trade_log.log_error(f"Live Price Angel for {clean_symbol}", e)

        # In paper mode, try yfinance latest price
        try:
            import yfinance as yf
            ticker_symbol = f"{clean_symbol}.NS"
            ticker = yf.Ticker(ticker_symbol)
            fast_info = getattr(ticker, "fast_info", None)
            if fast_info and "lastPrice" in fast_info and fast_info["lastPrice"] is not None:
                return float(fast_info["lastPrice"])

            if allow_slow_fallback:
                hist = ticker.history(period="1d", interval="1m")
                if not hist.empty:
                    return float(hist["Close"].iloc[-1])
        except Exception:
            pass

        if not allow_slow_fallback:
            return None

        # Fallback to last available historical price
        df = self.fetch_historical(clean_symbol, days=5)
        if not df.empty:
            return float(df["close"].iloc[-1])

        return None

    def _generate_sample(self, symbol: str, days: int = 504) -> pd.DataFrame:
        seed = sum(ord(c) for c in symbol)
        rng = np.random.RandomState(seed)
        dates = pd.date_range(end=datetime.now(), periods=days, freq="B")

        base_prices = {
            "RELIANCE": 2850, "TCS": 3900, "INFY": 1520, "HDFCBANK": 1650,
            "ICICIBANK": 1280, "SBIN": 630, "BHARTIARTL": 1520, "ITC": 460,
            "KOTAKBANK": 1780, "LT": 3450,
        }
        base = base_prices.get(symbol, 1000)
        returns = rng.normal(0.0004, 0.016, len(dates))
        prices = base * np.cumprod(1 + returns)

        df = pd.DataFrame({
            "date": dates,
            "open": prices * (1 + rng.uniform(-0.005, 0.005, len(dates))),
            "high": prices * (1 + rng.uniform(0.005, 0.03, len(dates))),
            "low": prices * (1 - rng.uniform(0.005, 0.03, len(dates))),
            "close": prices,
            "volume": rng.randint(300000, 4000000, len(dates)),
            "symbol": symbol,
        })
        return df
