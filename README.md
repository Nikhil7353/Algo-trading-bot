# StockBot - Indian Stock Market Trading Bot

Automated stock trading bot for the Indian stock market (NSE/BSE) with Angel One SmartAPI integration.

## Features

- **3 Trading Strategies**: EMA Crossover, RSI Reversal, Bollinger Breakout
- **Risk Management**: Position sizing, stop-loss, take-profit, daily loss limits
- **Paper Trading**: Simulate trades without real money
- **Live Trading**: Angel One SmartAPI integration
- **Backtesting**: Test strategies on historical data
- **REST API**: DRF endpoints for frontend/dashboard integration
- **SEBI Compliant**: Algo ID tagging, rate limiting, <10 orders/sec

## Quick Start

### 1. Setup

```bash
cd "D:\stock trading bot"

# Create virtual environment
python -m venv venv
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure

Edit `.env` file with your Angel One SmartAPI credentials:

```
ANGELONE_API_KEY=your_api_key_here
ANGELONE_CLIENT_ID=AACH879222
ANGELONE_PASSWORD=7353
ANGELONE_TOTP_SECRET=P5GGPN7KE7FU2IIEONZAD4T73Y
```

### 3. Run Migrations

```bash
cd backend
python manage.py migrate
python manage.py createsuperuser  # optional
```

### 4. Start the Server

```bash
python manage.py runserver
```

API available at: `http://127.0.0.1:8000/api/`

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/signals/` | GET | List all trading signals |
| `/api/orders/` | GET | List all orders |
| `/api/positions/` | GET | List open positions |
| `/api/portfolio/` | GET | Portfolio summary |
| `/api/scan/` | GET | Scan watchlist for signals |
| `/api/execute/` | POST | Execute a trade |
| `/api/backtest/` | POST | Run backtest on a symbol |
| `/api/backtest/watchlist/` | GET | Backtest all watchlist symbols |
| `/api/strategies/` | GET | List available strategies |

## Risk Defaults (₹25,000 Capital)

| Parameter | Value |
|---|---|
| Max position size | 5% = ₹1,250 |
| Stop loss | 2% |
| Take profit | 4% |
| Max open positions | 3 |
| Max daily loss | 2% = ₹500 |
| Max orders/day | 50 |
| Cooldown after loss | 5 minutes |

## Architecture

```
Signal Generation → Risk Check → Order Execution → Logging
      ↑                                           |
      └─────────── Market Data ←──────────────────┘
```

## SEBI Compliance Notes

- All algos run through Angel One (SEBI-registered broker)
- Rate limited to <10 orders/second
- Algo ID tagging via Angel One's system
- White-box algo (your own code) = simpler compliance
- Static IP required for live deployment
