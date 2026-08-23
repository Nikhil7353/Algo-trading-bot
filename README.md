# StockBot

Paper-first algo desk for **NSE equities**. Django REST API + React (Vite) UI, Angel One for live broker wiring, yfinance for market data, Groq for Copilot.

This stack is **paper-ready**. Live capital is not production-ready: AutoBot still paper-fills, and several risk/settings changes need a backend restart to take effect.

## What it does

- **Five strategies**: EMA crossover, RSI reversal, Bollinger breakout, Supertrend, VWAP
- **Risk envelope**: position size, stop-loss, take-profit, trailing stop, daily loss, open-lot cap
- **Paper book**: scan, execute, square-off, equity vs cash vs invested
- **Backtest lab**: single symbol or watchlist
- **Controls**: persist risk, strategies, watchlist to `config/settings.yaml`; Telegram / WhatsApp secrets to `.env`
- **Copilot**: Groq chat plus watchlist sentiment (falls back locally if no key)
- **AutoBot**: UI toggle; scans watchlist in the background (paper fills)

## Quick start

### 1. Backend

```bash
cd "D:\stock trading bot"
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Edit `.env`. At minimum set:

```
TRADING_MODE=paper
STOCKBOT_API_KEY=a-long-random-secret
DJANGO_DEBUG=True
DB_ENGINE=sqlite
```

Angel One, Groq, Telegram, and WhatsApp keys are optional until you use those features. Never put real credentials in this README or in git.

Then:

```bash
cd backend
python manage.py migrate
python manage.py runserver
```

API: `http://127.0.0.1:8000/api/`

PostgreSQL is available if `DB_ENGINE=postgresql` (default in Django settings when that env is unset). Use `DB_ENGINE=sqlite` for a local file at `db.sqlite3`.

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
```

Create `frontend/.env` so scan and execute send the same key:

```
VITE_STOCKBOT_API_KEY=a-long-random-secret
```

That value must match `STOCKBOT_API_KEY` in the root `.env`.

```bash
npm run dev
```

Desk: `http://localhost:3000` (Vite proxies `/api` to port 8000).

| Route | Page |
|---|---|
| `/` | Overview |
| `/signals` | Scanner |
| `/trades` | Book |
| `/backtest` | Lab |
| `/settings` | Controls |
| `/assistant` | Copilot |

## Config

| File | Role |
|---|---|
| `.env` | Secrets, `TRADING_MODE`, DB, Groq, alerts |
| `config/settings.yaml` | Capital, risk, active strategies, watchlist (NSE names) |
| `frontend/.env` | `VITE_STOCKBOT_API_KEY` |

Current YAML risk defaults (₹25,000 starting capital):

| Parameter | Value |
|---|---|
| Max position size | 25% |
| Stop-loss | 2% |
| Take-profit | 4% |
| Trailing stop | 1% |
| Max open positions | 5 |
| Max daily loss | 5% |
| Max orders/day | 50 |
| Cooldown after loss | 5 minutes |

Trading capital in Controls is YAML starting capital. Overview equity is cash + holdings and is not the same number.

After saving strategies or watchlist, **restart Django** so scans and AutoBot pick up the new values (settings are cached on first load).

## API

Prefix: `/api/`. `/api/scan/` and `/api/execute/` require header `X-API-Key`.

| Endpoint | Method | Description |
|---|---|---|
| `/signals/` | GET | Stored signals |
| `/orders/` | GET | Orders |
| `/positions/` | GET | Open lots |
| `/trades/` | GET | Trade log |
| `/performance/` | GET | Daily performance |
| `/portfolio/` | GET | Equity, cash, invested |
| `/scan/?symbol=` | GET | Scan one symbol (or watchlist if empty) |
| `/scan-watchlist/` | GET | Screener across the watchlist |
| `/execute/` | POST | Place a paper (or live-mode) order |
| `/emergency-squareoff/` | POST | Close all open lots |
| `/backtest/` | POST | Backtest one symbol |
| `/backtest/watchlist/` | GET | Backtest the watchlist |
| `/strategies/` | GET | Available + active strategies |
| `/settings/` | GET, POST | Load / save YAML + alert secrets |
| `/autotrader/status/` | GET | AutoBot state |
| `/autotrader/toggle/` | POST | Start / stop AutoBot |
| `/trades-calendar/` | GET | Calendar P&L |
| `/assistant/chat/` | POST | Copilot |
| `/assistant/sentiment/` | GET, POST | Watchlist sentiment |
| `/assistant/status/` | GET | LLM provider status |
| `/telegram-test/` | POST | Send a test Telegram message |
| `/whatsapp-test/` | POST | Send a test WhatsApp message |

## Architecture

```
Scanner / AutoBot → strategies → risk check → paper (or Angel One) fill → book + logs
                         ↑
              yfinance / last close (weekend)
```

Two execution paths exist: the scheduler (`backend/scheduler.py`) uses `RiskManager` + `OrderExecutor`; the UI AutoBot (`backend/execution/auto_trader.py`) always paper-fills. Do not treat them as one live engine.

## Honest limits

- Exchange in config is **NSE EQ only**, not BSE.
- Live mode talks to Angel One, but AutoBot still writes paper fills.
- “SEBI compliant” is not a claim this repo can make. Rate limits and algo tagging are broker-side; you still need your own compliance for live capital.
- Rotate any Angel One PIN, TOTP, or API key that ever appeared in git or this file.
