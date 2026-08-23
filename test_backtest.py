import os, sys
os.environ['DJANGO_SETTINGS_MODULE'] = 'stockbot.settings'
sys.path.insert(0, r'D:\stock trading bot\backend')
import django
django.setup()

from data.fetcher import DataFetcher
from backtesting.engine import BacktestEngine

fetcher = DataFetcher()
bt = BacktestEngine(["ema_crossover"], capital=25000)
data = fetcher.fetch_historical("RELIANCE", days=504)
print(f"Data: {len(data)} rows")

result = bt.run("RELIANCE", data)
print(f"Symbol: {result['symbol']}")
print(f"Trades: {result['total_trades']}")
print(f"Wins: {result['wins']}, Losses: {result['losses']}")
print(f"Win Rate: {result['win_rate']}%")
print(f"Total P&L: Rs {result['total_pnl']}")
print(f"Return: {result['total_return_pct']}%")
print(f"Max Drawdown: {result['max_drawdown_pct']}%")
print(f"Final Capital: Rs {result['final_capital']}")
