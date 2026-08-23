import json
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional
from django.utils import timezone

from core.models import Position, TradeLog, Signal, Order
from risk.manager import get_risk_manager
from core.config import get_settings


# -------------------------------------------------------------------------
# Tool Implementation Functions
# -------------------------------------------------------------------------

def get_positions(is_open: Optional[bool] = None) -> List[Dict[str, Any]]:
    """Retrieves current open or historical positions from the database."""
    qs = Position.objects.all()
    if is_open is not None:
        qs = qs.filter(is_open=is_open)

    results = []
    for p in qs[:20]:
        results.append({
            "id": str(p.id),
            "symbol": p.symbol,
            "side": p.side,
            "quantity": p.quantity,
            "entry_price": float(p.entry_price),
            "current_price": float(p.current_price),
            "stop_loss": float(p.stop_loss),
            "take_profit": float(p.take_profit),
            "unrealized_pnl": float(p.unrealized_pnl),
            "is_open": p.is_open,
            "opened_at": p.opened_at.strftime("%Y-%m-%d %H:%M") if p.opened_at else None,
        })
    return results


def get_trades(limit: int = 10, symbol: Optional[str] = None, days: int = 7) -> List[Dict[str, Any]]:
    """Retrieves recently executed trades with realized P&L and metrics."""
    qs = TradeLog.objects.all()
    if symbol:
        qs = qs.filter(symbol=symbol.upper())
    if days:
        since = timezone.now() - timedelta(days=days)
        qs = qs.filter(created_at__gte=since)

    results = []
    for t in qs[:limit]:
        results.append({
            "id": str(t.id),
            "symbol": t.symbol,
            "side": t.side,
            "quantity": t.quantity,
            "entry_price": float(t.entry_price),
            "exit_price": float(t.exit_price) if t.exit_price is not None else None,
            "pnl": float(t.pnl),
            "pnl_pct": float(t.pnl_pct),
            "strategy": t.strategy,
            "pnl_type": t.pnl_type,
            "created_at": t.created_at.strftime("%Y-%m-%d %H:%M") if t.created_at else None,
        })
    return results


def get_pnl_summary() -> Dict[str, Any]:
    """Calculates comprehensive P&L, win rate, daily stats, and capital metrics."""
    trades = list(TradeLog.objects.all())
    total_trades = len(trades)
    total_pnl = sum(float(t.pnl) for t in trades) if trades else 0.0

    wins = [t for t in trades if float(t.pnl) > 0]
    losses = [t for t in trades if float(t.pnl) < 0]
    win_rate = (len(wins) / total_trades * 100) if total_trades > 0 else 0.0

    today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_trades = [t for t in trades if t.created_at and t.created_at >= today_start]
    today_pnl = sum(float(t.pnl) for t in today_trades) if today_trades else 0.0

    rm = get_risk_manager()
    settings = get_settings()

    return {
        "total_pnl": round(total_pnl, 2),
        "today_pnl": round(today_pnl, 2),
        "total_trades": total_trades,
        "winning_trades": len(wins),
        "losing_trades": len(losses),
        "win_rate_pct": round(win_rate, 1),
        "today_trades_count": len(today_trades),
        "initial_capital": float(getattr(rm, "capital", 5000.0)),
        "current_capital": float(getattr(rm, "current_capital", getattr(rm, "capital", 5000.0))),
        "mode": settings.mode,
        "active_open_positions_count": Position.objects.filter(is_open=True).count(),
    }


def get_signals(limit: int = 10, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieves recent algorithmic trading signals with strategy rationale."""
    qs = Signal.objects.all()
    if symbol:
        qs = qs.filter(symbol=symbol.upper())

    results = []
    for s in qs[:limit]:
        results.append({
            "id": str(s.id),
            "symbol": s.symbol,
            "strategy": s.strategy,
            "action": s.action,
            "price": float(s.price),
            "strength": s.strength,
            "explanation": getattr(s, "explanation", "") or "",
            "created_at": s.created_at.strftime("%Y-%m-%d %H:%M") if s.created_at else None,
        })
    return results


def get_watchlist_sentiment(symbol: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieves recent AI news sentiment scores for watchlist equities."""
    from ai_assistant.models import StockSentiment
    qs = StockSentiment.objects.all()
    if symbol:
        qs = qs.filter(symbol=symbol.upper())

    results = []
    for s in qs:
        results.append({
            "symbol": s.symbol,
            "sentiment": s.sentiment,
            "score": s.score,
            "rationale": s.rationale,
            "headlines": s.headlines[:3] if s.headlines else [],
            "updated_at": s.updated_at.strftime("%Y-%m-%d %H:%M") if s.updated_at else None,
        })
    return results


def get_market_overview() -> Dict[str, Any]:
    """Retrieves current bot configuration, active strategies, and watchlist."""
    settings = get_settings()
    return {
        "trading_mode": settings.mode,
        "active_strategies": settings.active_strategies,
        "watchlist": settings.watchlist,
        "max_open_positions": getattr(settings, "max_open_positions", 2),
        "daily_loss_limit_pct": getattr(settings, "max_daily_loss_pct", 2.0),
    }


# -------------------------------------------------------------------------
# OpenAI-Compatible Tool Schemas
# -------------------------------------------------------------------------

ASSISTANT_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_positions",
            "description": "Get current open or historical positions including entry price, stop-loss, take-profit, and unrealized P&L.",
            "parameters": {
                "type": "object",
                "properties": {
                    "is_open": {
                        "type": "boolean",
                        "description": "Pass true for currently active positions, false for closed positions, or omit for all.",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_trades",
            "description": "Get recent closed trade history with entry/exit prices, realized P&L, and exit reasons.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max number of trades to return (default 10).",
                    },
                    "symbol": {
                        "type": "string",
                        "description": "Optional stock symbol filter, e.g. RELIANCE, TCS.",
                    },
                    "days": {
                        "type": "integer",
                        "description": "Number of past days to query (default 7).",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_pnl_summary",
            "description": "Calculate total realized P&L, today's P&L, win rate %, winning vs losing trades count, and capital status.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_signals",
            "description": "Get recent algorithmic signals generated by strategies (Supertrend, VWAP, EMA, RSI) with rationale.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max number of signals to return (default 10).",
                    },
                    "symbol": {
                        "type": "string",
                        "description": "Optional stock symbol filter, e.g. INFY.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_watchlist_sentiment",
            "description": "Get AI sentiment ratings (Bullish/Neutral/Bearish) and news summary for watchlist stocks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {
                        "type": "string",
                        "description": "Optional stock symbol filter, e.g. SBIN.",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_market_overview",
            "description": "Get the bot's current watchlist, active strategy configuration, risk limits, and paper/live trading mode.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


# -------------------------------------------------------------------------
# Tool Dispatcher
# -------------------------------------------------------------------------

TOOL_MAP = {
    "get_positions": get_positions,
    "get_trades": get_trades,
    "get_pnl_summary": get_pnl_summary,
    "get_signals": get_signals,
    "get_watchlist_sentiment": get_watchlist_sentiment,
    "get_market_overview": get_market_overview,
}


def execute_tool(name: str, arguments: Dict[str, Any]) -> Any:
    """Executes a registered assistant tool by name and arguments."""
    func = TOOL_MAP.get(name)
    if not func:
        return {"error": f"Tool '{name}' is not recognized"}
    try:
        return func(**arguments)
    except Exception as e:
        return {"error": f"Tool execution failed: {str(e)}"}
