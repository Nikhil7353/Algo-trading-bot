import json
import os
import threading
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, Tuple, Any

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
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self, cache_dir: Optional[Path] = None):
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self.cache_path = (cache_dir or (BASE_DIR / "data")) / "OpenAPIScripMaster.json"
        self._symbol_exchange_map: Dict[Tuple[str, str], str] = {}
        self._symbol_map: Dict[str, str] = dict(DEFAULT_NSE_TOKENS)
        self._is_loading = False
        self.load_instruments()

    def load_instruments(self, force_download: bool = False):
        """Load instrument tokens from local cache or trigger background download if missing."""
        if self.cache_path.exists():
            try:
                file_age = time.time() - os.path.getmtime(self.cache_path)
                if file_age <= (CACHE_EXPIRY_HOURS * 3600):
                    self._parse_cache_file()
                    return
            except OSError:
                pass

        # If cache exists (even if old), parse it first so we don't block
        if self.cache_path.exists():
            self._parse_cache_file()

        # Download fresh copy in a background thread to avoid blocking HTTP requests
        if not self._is_loading:
            threading.Thread(target=self._download_and_refresh, daemon=True).start()

    def _download_and_refresh(self):
        self._is_loading = True
        try:
            self._download_scrip_master()
            if self.cache_path.exists():
                self._parse_cache_file()
        finally:
            self._is_loading = False

    def _download_scrip_master(self):
        """Download fresh OpenAPIScripMaster.json from Angel One."""
        try:
            trade_log.logger.info("Downloading latest Angel One Scrip Master JSON in background...")
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
            new_sym_ex = {}
            new_sym = dict(DEFAULT_NSE_TOKENS)

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
                    new_sym_ex[(clean_sym, exch)] = token
                if name and exch:
                    new_sym_ex[(name, exch)] = token

                # Default fallback map (prefer NSE equity over BSE)
                if exch == "NSE" and (raw_symbol.endswith("-EQ") or item.get("instrumenttype") == ""):
                    if clean_sym:
                        new_sym[clean_sym] = token
                    if name:
                        new_sym[name] = token
                elif clean_sym not in new_sym:
                    new_sym[clean_sym] = token
                    if name:
                        new_sym[name] = token

                count += 1

            self._symbol_exchange_map = new_sym_ex
            self._symbol_map = new_sym
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
    _instance: Optional["DataFetcher"] = None
    _lock = threading.Lock()

    # In-memory TTL caches
    _live_price_cache: Dict[str, Tuple[float, float]] = {}  # symbol -> (price, timestamp)
    _hist_cache: Dict[str, Tuple[pd.DataFrame, float]] = {}  # key -> (df, timestamp)
    LIVE_CACHE_TTL = 15.0  # 15 seconds
    HIST_CACHE_TTL = 60.0  # 60 seconds

    def __new__(cls, *args, **kwargs):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self.settings = get_settings()
        self._client = None
        self._feed_token = None
        self._angel_connect_attempted = False
        self.token_master = InstrumentTokenMaster()

        # Connect to Angel One if credentials are present (regardless of paper or live mode)
        self._ensure_angel_connection()

    def get_token(self, symbol: str, exchange: str = "NSE") -> str:
        """Resolve an NSE/BSE trading symbol to its Angel One instrument token."""
        return self.token_master.resolve_token(symbol, exchange)

    def _ensure_angel_connection(self):
        """Connects to Angel One SmartAPI if credentials are present."""
        if self._client is not None or self._angel_connect_attempted:
            return

        self._angel_connect_attempted = True
        if not self.settings.angel_api_key or not self.settings.angel_client_id:
            trade_log.logger.info("Angel One credentials not configured. Using Yahoo Finance/Synthetic data.")
            return

        try:
            from SmartApi import SmartConnect
            import pyotp

            client = SmartConnect(self.settings.angel_api_key)
            totp = pyotp.TOTP(self.settings.angel_totp_secret).now() if self.settings.angel_totp_secret else ""
            data = client.generateSession(
                self.settings.angel_client_id,
                self.settings.angel_password,
                totp,
            )
            if data and data.get("status"):
                self._client = client
                self._feed_token = self._client.getfeedToken()
                trade_log.logger.info("Connected to Angel One SmartAPI (Market Data Active)")
            else:
                trade_log.log_error("Angel Auth", Exception(data.get("message", "Failed to login")))
        except ImportError:
            trade_log.logger.warning("smartapi-python or pyotp not installed. Using fallback.")
        except Exception as e:
            trade_log.log_error("Angel Connection", e)

    def fetch_live_price(
        self,
        symbol: str,
        exchange: str = "NSE",
        allow_slow_fallback: bool = True,
    ) -> Optional[float]:
        clean_symbol = symbol.upper().replace(".NS", "").replace(".BO", "").replace("-EQ", "").strip()

        # 1. Check in-memory cache first
        now = time.time()
        with self._lock:
            if clean_symbol in self._live_price_cache:
                cached_price, cached_at = self._live_price_cache[clean_symbol]
                if (now - cached_at) < self.LIVE_CACHE_TTL and cached_price > 0:
                    return cached_price

        # 2. Try Angel One LTP (Fastest: ~50ms)
        self._ensure_angel_connection()
        if self._client is not None:
            try:
                token = self.get_token(clean_symbol, exchange)
                data = self._client.ltpData(exchange, clean_symbol, token)
                if data and data.get("data") and "ltp" in data["data"]:
                    ltp = float(data["data"]["ltp"])
                    if ltp > 0:
                        with self._lock:
                            self._live_price_cache[clean_symbol] = (ltp, now)
                        return ltp
            except Exception as e:
                trade_log.logger.debug("Angel LTP failed for %s: %s", clean_symbol, e)

        # 3. Try yfinance fast_info
        if allow_slow_fallback:
            try:
                import yfinance as yf
                ticker_symbol = f"{clean_symbol}.NS"
                ticker = yf.Ticker(ticker_symbol)
                fast_info = getattr(ticker, "fast_info", None)
                if fast_info and "lastPrice" in fast_info and fast_info["lastPrice"] is not None:
                    ltp = float(fast_info["lastPrice"])
                    if ltp > 0:
                        with self._lock:
                            self._live_price_cache[clean_symbol] = (ltp, now)
                        return ltp
            except Exception:
                pass

            # 4. Fallback to historical candle close
            df = self.fetch_historical(clean_symbol, days=5)
            if not df.empty and "close" in df.columns:
                ltp = float(df["close"].iloc[-1])
                with self._lock:
                    self._live_price_cache[clean_symbol] = (ltp, now)
                return ltp

        return None

    def fetch_historical(
        self,
        symbol: str,
        exchange: str = "NSE",
        interval: str = "day",
        days: int = 504,
    ) -> pd.DataFrame:
        clean_symbol = symbol.upper().replace(".NS", "").replace(".BO", "").replace("-EQ", "").strip()
        cache_key = f"{clean_symbol}_{exchange}_{interval}_{days}"

        # 1. Check in-memory cache first
        now = time.time()
        with self._lock:
            if cache_key in self._hist_cache:
                cached_df, cached_at = self._hist_cache[cache_key]
                if (now - cached_at) < self.HIST_CACHE_TTL and not cached_df.empty:
                    return cached_df.copy()

        # 2. Try Angel One SmartAPI candles first if connected
        self._ensure_angel_connection()
        if self._client is not None:
            df = self._fetch_angel(clean_symbol, exchange, interval, days)
            if not df.empty:
                with self._lock:
                    self._hist_cache[cache_key] = (df, now)
                return df.copy()

        # 3. Fallback to yfinance
        df = self._fetch_yfinance(clean_symbol, days=days, interval=interval)
        if not df.empty:
            with self._lock:
                self._hist_cache[cache_key] = (df, now)
            return df.copy()

        # 4. Fallback to simulated data if network/yfinance is unavailable
        trade_log.logger.warning("Using synthetic data fallback for %s", clean_symbol)
        sample_df = self._generate_sample(clean_symbol, days)
        with self._lock:
            self._hist_cache[cache_key] = (sample_df, now)
        return sample_df.copy()

    _angel_api_lock = threading.Lock()
    _last_angel_call_at = 0.0

    def _fetch_angel(self, symbol: str, exchange: str, interval: str, days: int) -> pd.DataFrame:
        try:
            token = self.get_token(symbol, exchange)
            interval_map = {
                "day": "ONE_DAY",
                "1d": "ONE_DAY",
                "1h": "ONE_HOUR",
                "15m": "FIFTEEN_MINUTE",
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

            # Pace Angel One candle requests across threads to respect broker rate limits
            for attempt in range(2):
                with self._angel_api_lock:
                    now = time.time()
                    elapsed = now - DataFetcher._last_angel_call_at
                    if elapsed < 0.12:
                        time.sleep(0.12 - elapsed)
                    DataFetcher._last_angel_call_at = time.time()
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
                elif attempt == 0:
                    time.sleep(0.2)
        except Exception as e:
            trade_log.logger.debug("Angel Historical failed for %s: %s", symbol, e)
        return pd.DataFrame()

    def _fetch_yfinance(self, symbol: str, days: int = 504, interval: str = "day") -> pd.DataFrame:
        try:
            import yfinance as yf

            yf_interval_map = {
                "day": "1d",
                "1d": "1d",
                "1h": "1h",
                "15m": "15m",
                "5m": "5m",
                "1m": "1m",
            }
            yf_interval = yf_interval_map.get(interval, "1d")
            ticker_symbol = f"{symbol}.NS" if not symbol.endswith((".NS", ".BO")) else symbol

            period = f"{days}d" if yf_interval == "1d" else "60d"

            ticker = yf.Ticker(ticker_symbol)
            df = ticker.history(period=period, interval=yf_interval, timeout=6)

            if df is None or df.empty:
                return pd.DataFrame()

            df = df.reset_index()
            date_col = "Date" if "Date" in df.columns else "Datetime" if "Datetime" in df.columns else df.columns[0]
            df = df.rename(columns={
                date_col: "date",
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Volume": "volume",
            })

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

    def _generate_sample(self, symbol: str, days: int = 504) -> pd.DataFrame:
        seed = sum(ord(c) for c in symbol)
        rng = np.random.RandomState(seed)
        dates = pd.date_range(end=datetime.now(), periods=days, freq="B")

        base_prices = {
            "RELIANCE": 2850, "TCS": 3900, "INFY": 1520, "HDFCBANK": 1650,
            "ICICIBANK": 1280, "SBIN": 630, "BHARTIARTL": 1520, "ITC": 460,
            "KOTAKBANK": 1780, "LT": 3450, "TATAMOTORS": 980,
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

