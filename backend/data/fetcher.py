import os
from datetime import datetime, timedelta
from typing import Optional, Dict

import numpy as np
import pandas as pd

from core.config import get_settings
from core.logger import trade_log

# Common NSE Instrument Tokens for Angel One SmartAPI
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


class DataFetcher:
    def __init__(self):
        self.settings = get_settings()
        self._client = None
        self._feed_token = None
        self._token_map = dict(DEFAULT_NSE_TOKENS)

        if self.settings.mode == "live":
            self._connect_angel()

    def get_token(self, symbol: str) -> str:
        """Resolve an NSE trading symbol to its Angel One instrument token."""
        clean_symbol = symbol.upper().replace(".NS", "").replace(".BO", "").strip()
        return self._token_map.get(clean_symbol, clean_symbol)

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
            token = self.get_token(symbol)
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

    def fetch_live_price(self, symbol: str, exchange: str = "NSE") -> Optional[float]:
        clean_symbol = symbol.upper().replace(".NS", "").replace(".BO", "").strip()

        # If live mode and connected, use Angel One LTP
        if self.settings.mode == "live" and self._client is not None:
            try:
                token = self.get_token(clean_symbol)
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
            
            hist = ticker.history(period="1d", interval="1m")
            if not hist.empty:
                return float(hist["Close"].iloc[-1])
        except Exception:
            pass

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
