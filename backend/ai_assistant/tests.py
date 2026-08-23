import uuid
from decimal import Decimal
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from ai_assistant.models import DailyJournal, StockSentiment
from ai_assistant.services import (
    AssistantChatService,
    DailyJournalSummarizer,
    NewsSentimentAnalyzer,
    SignalExplainer,
)
from ai_assistant.tools import (
    execute_tool,
    get_market_overview,
    get_pnl_summary,
    get_positions,
    get_signals,
    get_trades,
)
from core.models import Position, Signal, TradeLog


class AIAssistantToolsTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Seed sample TradeLog
        self.trade1 = TradeLog.objects.create(
            symbol="RELIANCE",
            side="BUY",
            quantity=10,
            entry_price=Decimal("2800.00"),
            exit_price=Decimal("2850.00"),
            pnl=Decimal("500.00"),
            pnl_pct=1.78,
            strategy="supertrend",
            pnl_type="REALIZED",
        )
        self.trade2 = TradeLog.objects.create(
            symbol="TCS",
            side="BUY",
            quantity=5,
            entry_price=Decimal("3800.00"),
            exit_price=Decimal("3750.00"),
            pnl=Decimal("-250.00"),
            pnl_pct=-1.31,
            strategy="ema_crossover",
            pnl_type="REALIZED",
        )

        # Seed sample Position
        self.position = Position.objects.create(
            symbol="INFY",
            side="LONG",
            quantity=15,
            entry_price=Decimal("1500.00"),
            current_price=Decimal("1520.00"),
            stop_loss=Decimal("1470.00"),
            take_profit=Decimal("1560.00"),
            unrealized_pnl=Decimal("300.00"),
            is_open=True,
        )

        # Seed sample Signal
        self.signal = Signal.objects.create(
            symbol="SBIN",
            strategy="supertrend",
            action="BUY",
            price=Decimal("800.00"),
            strength=0.85,
            explanation="Supertrend flipped bullish at Rs800.",
            metadata_json={"supertrend": 795.0, "atr": 6.5},
        )

    def test_get_positions_tool(self):
        positions = get_positions(is_open=True)
        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0]["symbol"], "INFY")
        self.assertEqual(positions[0]["unrealized_pnl"], 300.0)

    def test_get_trades_tool(self):
        trades = get_trades(limit=5)
        self.assertEqual(len(trades), 2)
        symbols = [t["symbol"] for t in trades]
        self.assertIn("RELIANCE", symbols)
        self.assertIn("TCS", symbols)

    def test_get_pnl_summary_tool(self):
        pnl = get_pnl_summary()
        self.assertEqual(pnl["total_pnl"], 250.0)
        self.assertEqual(pnl["total_trades"], 2)
        self.assertEqual(pnl["winning_trades"], 1)
        self.assertEqual(pnl["losing_trades"], 1)
        self.assertEqual(pnl["win_rate_pct"], 50.0)

    def test_get_signals_tool(self):
        signals = get_signals(limit=5)
        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["symbol"], "SBIN")
        self.assertEqual(signals[0]["strategy"], "supertrend")

    def test_execute_tool_dispatcher(self):
        res = execute_tool("get_pnl_summary", {})
        self.assertIn("total_pnl", res)
        self.assertEqual(res["total_pnl"], 250.0)

        err = execute_tool("non_existent_tool", {})
        self.assertIn("error", err)

    def test_signal_explainer_rule_based_fallback(self):
        explanation_ema = SignalExplainer.explain_signal(
            symbol="TCS",
            strategy="ema_crossover",
            action="BUY",
            price=3800.0,
            metadata={"rsi": 58, "fast_ema": 9, "slow_ema": 21},
        )
        self.assertIn("EMA(9)", explanation_ema)
        self.assertIn("bullish", explanation_ema.lower())

        explanation_vwap = SignalExplainer.explain_signal(
            symbol="INFY",
            strategy="vwap",
            action="SELL",
            price=1500.0,
            metadata={"vwap": 1510.0, "rsi": 45},
        )
        self.assertIn("VWAP", explanation_vwap)
        self.assertIn("selling", explanation_vwap.lower())

    def test_daily_journal_summarizer(self):
        journal = DailyJournalSummarizer.generate_daily_journal(send_alerts=False)
        self.assertIsNotNone(journal)
        self.assertEqual(journal.trades_count, 2)
        self.assertEqual(journal.total_pnl, Decimal("250.00"))
        self.assertIn("250.00", journal.summary)

    def test_news_sentiment_rule_based_fallback(self):
        headlines = [
            {"title": "RELIANCE Q3 Profit Jumps 15% with Strong Retail Growth", "link": ""},
            {"title": "Brokerages Raise Target Price on RELIANCE to Record Highs", "link": ""},
        ]
        sentiment, score, rationale = NewsSentimentAnalyzer._score_sentiment("RELIANCE", headlines)
        self.assertEqual(sentiment, "BULLISH")
        self.assertGreater(score, 0.0)

    def test_chat_assistant_offline_mode(self):
        res = AssistantChatService._offline_chat_response("What is my P&L today?")
        self.assertIn("response", res)
        self.assertIn("Performance & P&L Summary", res["response"])
        self.assertTrue(len(res["tools_used"]) > 0)

    def test_api_assistant_endpoints(self):
        # 1. Status endpoint
        resp = self.client.get("/api/assistant/status/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("provider", resp.data)

        # 2. Chat endpoint
        resp = self.client.post("/api/assistant/chat/", {"message": "Show open positions"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("response", resp.data)
        self.assertIn("INFY", resp.data["response"])

        # 3. Explain Signal endpoint
        resp = self.client.post(
            "/api/assistant/explain-signal/",
            {"symbol": "RELIANCE", "strategy": "supertrend", "action": "BUY", "price": 2850.0},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("explanation", resp.data)

        # 4. Daily Summary endpoint
        resp = self.client.get("/api/assistant/daily-summary/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("journals", resp.data)
