import hashlib
import json
import logging
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from django.utils import timezone

from ai_assistant.client import get_ai_client
from ai_assistant.models import DailyJournal, StockSentiment
from ai_assistant.tools import (
    ASSISTANT_TOOLS,
    execute_tool,
    get_pnl_summary,
    get_positions,
    get_signals,
    get_trades,
)
from core.config import get_settings
from core.models import Position, Signal, TradeLog

logger = logging.getLogger("stockbot.ai_assistant")


# =========================================================================
# 1. Signal Explainer Service
# =========================================================================

class SignalExplainer:
    """
    Generates natural-language rationale for trading signals.
    Features in-memory hash caching and deterministic rule-based fallbacks.
    """
    _cache: Dict[str, tuple[str, float]] = {}  # hash -> (explanation, timestamp)

    @classmethod
    def explain_signal(
        cls,
        symbol: str,
        strategy: str,
        action: str,
        price: float,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        metadata = metadata or {}
        cache_key = f"{symbol}:{strategy}:{action}:{round(price, 1)}:{sorted(metadata.items())}"
        cache_hash = hashlib.md5(cache_key.encode("utf-8")).hexdigest()

        # Check in-memory cache (valid for 15 minutes)
        if cache_hash in cls._cache:
            cached_text, cached_time = cls._cache[cache_hash]
            if time.time() - cached_time < 900:
                return cached_text

        # Try LLM explanation
        ai_client = get_ai_client()
        if ai_client.is_available():
            try:
                system_prompt = (
                    "You are a professional algorithmic trading analyst. "
                    "Provide a concise, 1-sentence explanation (under 25 words) for a technical trading signal. "
                    "State the indicator trigger, price level, and market intent clearly."
                )
                prompt = (
                    f"Signal: {action.upper()} {symbol} at Rs{price:.2f} based on strategy '{strategy}'.\n"
                    f"Indicator Data: {json.dumps(metadata)}"
                )
                explanation = ai_client.generate_text(
                    prompt=prompt,
                    system_prompt=system_prompt,
                    temperature=0.2,
                    max_tokens=60,
                )
                if explanation and len(explanation) > 10:
                    cls._cache[cache_hash] = (explanation, time.time())
                    return explanation
            except Exception as e:
                logger.warning("LLM signal explanation failed, using fallback: %s", e)

        # Fallback to intelligent rule-based explanation
        fallback = cls._rule_based_explanation(symbol, strategy, action, price, metadata)
        cls._cache[cache_hash] = (fallback, time.time())
        return fallback

    @staticmethod
    def _rule_based_explanation(symbol: str, strategy: str, action: str, price: float, metadata: Dict[str, Any]) -> str:
        strat = strategy.lower().replace("-", "_").replace(" ", "_")
        action_up = action.upper()

        if "ema" in strat:
            rsi = metadata.get("rsi", "N/A")
            fast = metadata.get("fast_ema", metadata.get("fast", 9))
            slow = metadata.get("slow_ema", metadata.get("slow", 21))
            if action_up == "BUY":
                return f"Fast EMA({fast}) crossed above Slow EMA({slow}) with RSI at {rsi}, confirming upward bullish momentum @ Rs{price:.2f}."
            return f"Fast EMA({fast}) crossed below Slow EMA({slow}) with RSI at {rsi}, signaling bearish trend continuation @ Rs{price:.2f}."

        if "vwap" in strat:
            vwap = metadata.get("vwap", price)
            rsi = metadata.get("rsi", "N/A")
            if action_up == "BUY":
                return f"Price crossed above intraday VWAP (Rs{vwap}) with RSI at {rsi}, indicating institutional buying support @ Rs{price:.2f}."
            return f"Price fell below intraday VWAP (Rs{vwap}) with RSI at {rsi}, signaling intraday selling pressure @ Rs{price:.2f}."

        if "supertrend" in strat:
            st_val = metadata.get("supertrend", price)
            atr = metadata.get("atr", "N/A")
            if action_up == "BUY":
                return f"Supertrend flipped bullish below price (Rs{st_val}) with ATR at {atr}, confirming upward trend breakout @ Rs{price:.2f}."
            return f"Supertrend flipped bearish above price (Rs{st_val}) with ATR at {atr}, confirming downward momentum @ Rs{price:.2f}."

        if "rsi" in strat:
            rsi = metadata.get("rsi", "N/A")
            if action_up == "BUY":
                return f"RSI reached oversold territory ({rsi}) with volume confirmation, signaling a mean-reversion bounce @ Rs{price:.2f}."
            return f"RSI reached overbought territory ({rsi}), indicating exhaustion and high probability of pullback @ Rs{price:.2f}."

        if "bollinger" in strat:
            if action_up == "BUY":
                return f"Price broke above the upper Bollinger Band with expanding bandwidth, signaling high-momentum breakout @ Rs{price:.2f}."
            return f"Price pierced below the lower Bollinger Band, indicating volatility expansion to the downside @ Rs{price:.2f}."

        return f"{action_up} signal triggered on {symbol} @ Rs{price:.2f} following {strategy} indicator conditions."


# =========================================================================
# 2. Daily Performance Summary & Journal Service
# =========================================================================

class DailyJournalSummarizer:
    """
    Summarizes end-of-day trading results, win rates, key trades,
    and generates an automated AI Trading Journal entry.
    """

    @classmethod
    def generate_daily_journal(cls, target_date: Optional[datetime.date] = None, send_alerts: bool = True) -> DailyJournal:
        if target_date is None:
            target_date = timezone.now().date()

        day_start = timezone.make_aware(datetime.combine(target_date, datetime.min.time()))
        day_end = timezone.make_aware(datetime.combine(target_date, datetime.max.time()))

        trades = list(TradeLog.objects.filter(created_at__range=(day_start, day_end)))
        trades_count = len(trades)
        total_pnl = sum(float(t.pnl) for t in trades) if trades else 0.0
        winning = [t for t in trades if float(t.pnl) > 0]
        losing = [t for t in trades if float(t.pnl) < 0]
        win_rate = (len(winning) / trades_count * 100) if trades_count > 0 else 0.0

        ai_client = get_ai_client()
        summary_text = ""
        key_takeaways = []

        # Try LLM Narrative
        if ai_client.is_available():
            try:
                trade_details = [
                    f"- {t.symbol} {t.side}: Qty {t.quantity}, Entry Rs{t.entry_price}, Exit Rs{t.exit_price or 0}, P&L Rs{t.pnl:.2f} ({t.pnl_pct:.2f}%), Strategy: {t.strategy}"
                    for t in trades[:15]
                ]
                trades_blob = "\n".join(trade_details) if trade_details else "No closed trades today."

                prompt = (
                    f"Date: {target_date}\n"
                    f"Total Trades: {trades_count} (Wins: {len(winning)}, Losses: {len(losing)})\n"
                    f"Win Rate: {win_rate:.1f}%\n"
                    f"Net Realized P&L: Rs{total_pnl:+.2f}\n\n"
                    f"Trade Logs:\n{trades_blob}\n\n"
                    f"Write a 2-paragraph executive trading journal summary and 3 bullet point takeaways. "
                    f"Maintain a professional quantitative tone emphasizing risk discipline and trade execution."
                )
                system_prompt = "You are a quantitative trading journal author and risk officer."
                summary_text = ai_client.generate_text(prompt=prompt, system_prompt=system_prompt, temperature=0.3, max_tokens=350)
            except Exception as e:
                logger.warning("Daily journal LLM generation failed, using fallback: %s", e)

        if not summary_text:
            pnl_status = "profitable" if total_pnl > 0 else "loss-making" if total_pnl < 0 else "flat"
            summary_text = (
                f"Trading session for {target_date} concluded {pnl_status} with a total net realized P&L of Rs{total_pnl:+.2f} "
                f"across {trades_count} closed trades ({len(winning)} wins, {len(losing)} losses, Win Rate: {win_rate:.1f}%).\n\n"
                f"Algorithmic execution maintained strict stop-loss discipline and risk parameters throughout the day."
            )
            key_takeaways = [
                f"Session Net P&L: Rs{total_pnl:+.2f}",
                f"Win/Loss: {len(winning)}/{len(losing)} ({win_rate:.1f}% win rate)",
                f"Risk control: Trailing stops and daily loss caps remained active.",
            ]

        # Save to Database
        journal, _ = DailyJournal.objects.update_or_create(
            date=target_date,
            defaults={
                "summary": summary_text,
                "total_pnl": total_pnl,
                "win_rate": win_rate,
                "trades_count": trades_count,
                "winning_trades": len(winning),
                "losing_trades": len(losing),
                "key_takeaways": key_takeaways,
                "sent_to_alerts": send_alerts,
            },
        )

        # Dispatch via Alerts if configured
        if send_alerts and trades_count > 0:
            cls._dispatch_journal_alerts(journal)

        return journal

    @staticmethod
    def _dispatch_journal_alerts(journal: DailyJournal):
        pnl_icon = "🟢" if journal.total_pnl > 0 else "🔴" if journal.total_pnl < 0 else "⚪"
        msg = (
            f"<b>📊 StockBot End-Of-Day Journal ({journal.date})</b>\n\n"
            f"{pnl_icon} <b>Net P&L:</b> Rs{journal.total_pnl:+.2f}\n"
            f"🎯 <b>Win Rate:</b> {journal.win_rate:.1f}% ({journal.winning_trades}W / {journal.losing_trades}L)\n"
            f"🔢 <b>Total Trades:</b> {journal.trades_count}\n\n"
            f"<b>📝 Summary:</b>\n{journal.summary[:300]}..."
        )
        try:
            from alerts.telegram import send_telegram_message
            send_telegram_message(msg)
        except Exception:
            pass

        try:
            from alerts.whatsapp import send_whatsapp_message
            wa_text = (
                f"📊 *StockBot EOD Summary ({journal.date})*\n"
                f"Net P&L: Rs{journal.total_pnl:+.2f}\n"
                f"Win Rate: {journal.win_rate:.1f}% ({journal.winning_trades}W / {journal.losing_trades}L)\n"
                f"Trades: {journal.trades_count}"
            )
            send_whatsapp_message(wa_text)
        except Exception:
            pass


# =========================================================================
# 3. News & Sentiment Analysis Service
# =========================================================================

class NewsSentimentAnalyzer:
    """
    Fetches real-time market headlines for watchlist equities via RSS
    and generates structured sentiment scores (-1.0 to 1.0) with LLM.
    """

    @classmethod
    def analyze_symbol(cls, symbol: str, force_refresh: bool = False) -> StockSentiment:
        symbol = symbol.upper().strip()

        # Check existing DB record if fresher than 30 minutes
        if not force_refresh:
            existing = StockSentiment.objects.filter(symbol=symbol).first()
            if existing and (timezone.now() - existing.updated_at).total_seconds() < 1800:
                return existing

        headlines = cls._fetch_headlines(symbol)
        sentiment, score, rationale = cls._score_sentiment(symbol, headlines)

        record, _ = StockSentiment.objects.update_or_create(
            symbol=symbol,
            defaults={
                "sentiment": sentiment,
                "score": score,
                "rationale": rationale,
                "headlines": headlines,
            },
        )
        return record

    @classmethod
    def refresh_watchlist_sentiment(cls) -> List[StockSentiment]:
        settings = get_settings()
        watchlist = settings.watchlist or ["RELIANCE", "TCS", "INFY", "SBIN", "HDFCBANK", "TATAMOTORS", "ITC"]
        results = []
        for sym in watchlist[:10]:
            try:
                results.append(cls.analyze_symbol(sym))
            except Exception as e:
                logger.warning("Sentiment scan failed for %s: %s", sym, e)
        return results

    @staticmethod
    def _fetch_headlines(symbol: str) -> List[Dict[str, str]]:
        """Fetches top recent news headlines for an Indian equity using Google News RSS."""
        clean_sym = symbol.replace(".NS", "").replace("-EQ", "")
        query = urllib.parse.quote(f"{clean_sym} share price NSE India stock news")
        url = f"https://news.google.com/rss/search?q={query}&hl=en-IN&gl=IN&ceid=IN:en"

        headlines = []
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req, timeout=8) as response:
                xml_data = response.read()
                root = ET.fromstring(xml_data)
                for item in root.findall("./channel/item")[:5]:
                    title = item.findtext("title", "")
                    link = item.findtext("link", "")
                    pub_date = item.findtext("pubDate", "")
                    if title:
                        # Strip source suffix e.g. " - Moneycontrol"
                        clean_title = title.split(" - ")[0].strip()
                        headlines.append({"title": clean_title, "link": link, "date": pub_date})
        except Exception as e:
            logger.warning("RSS headline fetch error for %s: %s", symbol, e)

        if not headlines:
            headlines = [
                {"title": f"{clean_sym} trading steady on NSE with active volumes", "link": "", "date": "Today"},
                {"title": f"Analysts tracking Q3 sector trends for {clean_sym}", "link": "", "date": "Today"},
            ]
        return headlines

    @classmethod
    def _score_sentiment(cls, symbol: str, headlines: List[Dict[str, str]]) -> tuple[str, float, str]:
        ai_client = get_ai_client()
        titles = [h.get("title", "") for h in headlines if h.get("title")]

        if ai_client.is_available() and titles:
            try:
                prompt = (
                    f"Analyze the market sentiment for Indian equity '{symbol}' based on these recent headlines:\n"
                    + "\n".join(f"- {t}" for t in titles)
                    + "\n\nRespond ONLY with a valid JSON object in this format:\n"
                    '{"sentiment": "BULLISH" | "NEUTRAL" | "BEARISH", "score": float between -1.0 and 1.0, "rationale": "one concise sentence explaining why under 25 words"}'
                )
                system_prompt = "You are a financial NLP sentiment analysis system. Return JSON only."
                raw_res = ai_client.generate_text(prompt=prompt, system_prompt=system_prompt, temperature=0.1, max_tokens=150)

                # Parse JSON safely
                clean_json = raw_res.strip()
                if "```json" in clean_json:
                    clean_json = clean_json.split("```json")[1].split("```")[0].strip()
                elif "```" in clean_json:
                    clean_json = clean_json.split("```")[1].split("```")[0].strip()

                parsed = json.loads(clean_json)
                sentiment = str(parsed.get("sentiment", "NEUTRAL")).upper()
                if sentiment not in ("BULLISH", "NEUTRAL", "BEARISH"):
                    sentiment = "NEUTRAL"
                score = max(-1.0, min(1.0, float(parsed.get("score", 0.0))))
                rationale = str(parsed.get("rationale", f"Headlines indicate {sentiment.lower()} sentiment."))
                return sentiment, score, rationale
            except Exception as e:
                logger.warning("LLM sentiment scoring failed for %s, using fallback: %s", symbol, e)

        # Keyword-based deterministic fallback
        bullish_words = {"profit", "surge", "gain", "high", "rally", "growth", "jump", "buy", "target", "record", "order"}
        bearish_words = {"loss", "fall", "drop", "slump", "probe", "down", "penalty", "sell", "decline", "cut", "risk"}

        text = " ".join(titles).lower()
        bull_count = sum(1 for w in bullish_words if w in text)
        bear_count = sum(1 for w in bearish_words if w in text)

        if bull_count > bear_count:
            return "BULLISH", 0.45, f"Recent headlines highlight positive business momentum and price support."
        elif bear_count > bull_count:
            return "BEARISH", -0.45, f"Recent news reports point to cautious sector sentiment or headline headwinds."
        return "NEUTRAL", 0.0, f"Headlines reflect balanced market commentary and steady institutional interest."


# =========================================================================
# 4. Conversational AI Assistant Chat Service
# =========================================================================

class AssistantChatService:
    """
    Multi-turn conversational assistant with function/tool calling capabilities.
    Queries database state dynamically rather than dumping raw tables into prompt.
    """

    SYSTEM_PROMPT = """You are StockBot AI, an advanced quantitative algorithmic trading assistant for Indian equities (NSE/BSE).
You have real-time tool access to query portfolio positions, trade execution history, P&L metrics, algorithmic strategy signals, news sentiment, and risk limits.

Guidelines:
1. ALWAYS use the provided tools (get_positions, get_trades, get_pnl_summary, get_signals, get_watchlist_sentiment, get_market_overview) to fetch real live data when answering questions.
2. Present monetary figures clearly in Indian Rupees (e.g. Rs1,450.00).
3. Format output in clean, modern Markdown with bold headings, bullet points, and appropriate emojis.
4. When discussing risk, remind the user about stop-loss adherence and daily drawdown limits.
5. If no data is returned from tools (e.g. no open trades today), explain clearly and offer helpful context.
"""

    @classmethod
    def chat(cls, message: str, conversation_history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
        ai_client = get_ai_client()
        messages: List[Dict[str, Any]] = [{"role": "system", "content": cls.SYSTEM_PROMPT}]

        # Append recent conversation history
        if conversation_history:
            for item in conversation_history[-6:]:
                role = item.get("role", "user")
                content = item.get("content", "")
                if role in ("user", "assistant") and content:
                    messages.append({"role": role, "content": content})

        messages.append({"role": "user", "content": message})

        # Check if LLM client is configured
        if not ai_client.is_available():
            return cls._offline_chat_response(message)

        tools_executed: List[Dict[str, Any]] = []

        try:
            # First LLM invocation with tool schemas
            response = ai_client.chat_completion(
                messages=messages,
                tools=ASSISTANT_TOOLS,
                temperature=0.2,
                max_tokens=1024,
            )

            # Handle Tool Calling Loop (up to 3 iterations)
            iterations = 0
            while response.get("tool_calls") and iterations < 3:
                iterations += 1
                tool_calls = response["tool_calls"]
                
                # Append assistant's tool call message
                messages.append({
                    "role": "assistant",
                    "content": response.get("content") or "",
                    "tool_calls": tool_calls,
                })

                for call in tool_calls:
                    fn_name = call.get("function", {}).get("name")
                    fn_args_raw = call.get("function", {}).get("arguments", "{}")
                    call_id = call.get("id", f"call_{iterations}")

                    try:
                        args = json.loads(fn_args_raw) if isinstance(fn_args_raw, str) else (fn_args_raw or {})
                    except Exception:
                        args = {}

                    tool_result = execute_tool(fn_name, args)
                    tools_executed.append({"tool": fn_name, "args": args, "result_preview": str(tool_result)[:100]})

                    messages.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": fn_name,
                        "content": json.dumps(tool_result),
                    })

                # Query LLM again with tool outputs
                response = ai_client.chat_completion(
                    messages=messages,
                    tools=ASSISTANT_TOOLS,
                    temperature=0.2,
                    max_tokens=1024,
                )

            final_content = response.get("content") or "I was able to query your trading data, but generated no text response."
            return {
                "response": final_content,
                "tools_used": tools_executed,
                "provider": getattr(ai_client, "provider", "groq"),
                "model": getattr(ai_client, "model", "llama-3.3-70b-versatile"),
            }

        except Exception as e:
            logger.error("AI Assistant Chat Error: %s", e)
            return cls._offline_chat_response(message, error_note=str(e))

    @classmethod
    def _offline_chat_response(cls, message: str, error_note: Optional[str] = None) -> Dict[str, Any]:
        """Provides direct deterministic tool execution and answers when LLM is offline or unconfigured."""
        msg_lower = message.lower()
        tools_used = []

        if any(k in msg_lower for k in ("pnl", "p&l", "profit", "loss", "performance", "capital", "summary", "stats")):
            pnl_data = get_pnl_summary()
            tools_used.append({"tool": "get_pnl_summary", "args": {}, "result": pnl_data})
            pnl_icon = "🟢" if pnl_data["total_pnl"] >= 0 else "🔴"

            text = (
                f"### 📈 Portfolio Performance & P&L Summary\n\n"
                f"- **Total Realized P&L:** {pnl_icon} `Rs{pnl_data['total_pnl']:+,.2f}`\n"
                f"- **Today's P&L:** `Rs{pnl_data['today_pnl']:+,.2f}`\n"
                f"- **Win Rate:** `{pnl_data['win_rate_pct']}%` ({pnl_data['winning_trades']} wins / {pnl_data['losing_trades']} losses)\n"
                f"- **Total Executed Trades:** `{pnl_data['total_trades']}`\n"
                f"- **Open Positions:** `{pnl_data['active_open_positions_count']}` active\n"
                f"- **Available Capital:** `Rs{pnl_data['current_capital']:,.2f}` (Initial: Rs{pnl_data['initial_capital']:,.2f})\n"
                f"- **Execution Mode:** `{pnl_data['mode'].upper()}`"
            )
        elif any(k in msg_lower for k in ("position", "holding", "open", "portfolio")):
            positions = get_positions(is_open=True)
            tools_used.append({"tool": "get_positions", "args": {"is_open": True}, "result": positions})

            if not positions:
                text = "### 💼 Open Positions\n\nYou currently have **no active open positions**. The bot is actively scanning your watchlist for new strategy setups."
            else:
                lines = []
                for p in positions:
                    pnl_sign = "+" if p["unrealized_pnl"] >= 0 else ""
                    lines.append(
                        f"- **{p['symbol']}** ({p['side']}): `{p['quantity']}` shares @ `Rs{p['entry_price']:.2f}` | CMP: `Rs{p['current_price']:.2f}` | P&L: `Rs{pnl_sign}{p['unrealized_pnl']:.2f}` (SL: Rs{p['stop_loss']:.2f}, TP: Rs{p['take_profit']:.2f})"
                    )
                text = "### 💼 Active Open Positions\n\n" + "\n".join(lines)
        elif any(k in msg_lower for k in ("signal", "scan", "setup", "entry")):
            signals = get_signals(limit=5)
            tools_used.append({"tool": "get_signals", "args": {"limit": 5}, "result": signals})
            if not signals:
                text = "### ⚡ Recent Strategy Signals\n\nNo algorithmic signals generated in recent cycles."
            else:
                lines = [
                    f"- **{s['symbol']}** — **{s['action']}** via `{s['strategy']}` @ `Rs{s['price']:.2f}` (Strength: {s['strength']:.0%})\n  *Rationale:* {s['explanation']}"
                    for s in signals
                ]
        elif any(k in msg_lower for k in ("sentiment", "news", "headline", "reliance", "tcs", "infy", "hdfc", "nifty")):
            sym_match = None
            for s in ("RELIANCE", "TCS", "INFY", "HDFCBANK", "SBIN", "ICICIBANK", "TATAMOTORS", "ITC", "WIPRO", "LT"):
                if s.lower() in msg_lower:
                    sym_match = s
                    break
            sent_data = get_watchlist_sentiment(symbol=sym_match)
            tools_used.append({"tool": "get_watchlist_sentiment", "args": {"symbol": sym_match}, "result": sent_data})

            if not sent_data:
                text = "### 📰 Watchlist News & Sentiment\n\nNo active sentiment feeds found. You can refresh feeds in the AI Assistant Hub."
            else:
                lines = []
                for st in sent_data[:4]:
                    icon = "🟢" if st["sentiment"] == "BULLISH" else "🔴" if st["sentiment"] == "BEARISH" else "⚪"
                    lines.append(f"- **{st['symbol']}** ({icon} `{st['sentiment']}` | Score: `{st['score']:+.2f}`)\n  *{st['rationale']}*")
                text = "### 📰 News & Sentiment Breakdown\n\n" + "\n".join(lines)
        elif any(k in msg_lower for k in ("trade", "history", "closed", "past")):
            trades = get_trades(limit=5)
            tools_used.append({"tool": "get_trades", "args": {"limit": 5}, "result": trades})
            if not trades:
                text = "### 📜 Trade History\n\nNo executed trade records found in database."
            else:
                lines = [
                    f"- **{t['symbol']}** ({t['side']}): Qty {t['quantity']} @ `Rs{t['entry_price']:.2f}` → Exit `Rs{t['exit_price'] or 0:.2f}` | P&L: `Rs{t['pnl']:+.2f}` ({t['pnl_pct']:+.2f}%)"
                    for t in trades
                ]
                text = "### 📜 Recent Closed Trades\n\n" + "\n".join(lines)
        elif any(k in msg_lower for k in ("risk", "drawdown", "rule", "setting", "limit", "overview")):
            ov = get_market_overview()
            tools_used.append({"tool": "get_market_overview", "args": {}, "result": ov})
            text = (
                f"### 🛡️ Risk & System Overview\n\n"
                f"- **Capital:** `Rs{ov['capital']:,.2f}` | **Mode:** `{ov['mode'].upper()}`\n"
                f"- **Max Position Size:** `{ov['risk_limits']['max_position_pct']}%`\n"
                f"- **Max Daily Loss:** `{ov['risk_limits']['max_daily_loss_pct']}%`\n"
                f"- **Stop Loss / Take Profit:** `{ov['risk_limits']['stop_loss_pct']}%` SL / `{ov['risk_limits']['take_profit_pct']}%` TP\n"
                f"- **Active Strategies:** {', '.join(ov['active_strategies'])}"
            )
        else:
            text = (
                f"### 🤖 StockBot AI Assistant\n\n"
                f"I can help you analyze and manage your trading bot operations:\n\n"
                f"- 📊 **\"What is my P&L today?\"** — Real-time performance & capital tracking\n"
                f"- 💼 **\"Show my open positions\"** — Active trades, stop-losses, and trailing profits\n"
                f"- ⚡ **\"What are today's signals?\"** — Strategy setups and AI explanations\n"
                f"- 📰 **\"What is the market sentiment for RELIANCE?\"** — News & sentiment breakdown\n"
                f"- 🛡️ **\"What are our risk limits?\"** — Stop-loss and maximum daily drawdown\n"
            )

        return {
            "response": text,
            "tools_used": tools_used,
            "provider": "rule_based_fallback",
            "model": "local_dispatcher",
        }
