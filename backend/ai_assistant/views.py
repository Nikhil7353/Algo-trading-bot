from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from ai_assistant.client import get_ai_client
from ai_assistant.models import DailyJournal, StockSentiment
from ai_assistant.services import (
    AssistantChatService,
    DailyJournalSummarizer,
    NewsSentimentAnalyzer,
    SignalExplainer,
)
from core.config import get_settings


class ChatAssistantView(APIView):
    """
    POST /api/assistant/chat/
    Conversational AI Assistant endpoint supporting natural language queries with real DB tools.
    """
    def post(self, request):
        message = str(request.data.get("message", "")).strip()
        if not message:
            return Response({"error": "Message parameter is required"}, status=status.HTTP_400_BAD_REQUEST)

        history = request.data.get("history", [])
        if not isinstance(history, list):
            history = []

        result = AssistantChatService.chat(message=message, conversation_history=history)
        return Response(result)


class SignalExplanationView(APIView):
    """
    POST /api/assistant/explain-signal/
    Generates a natural language explanation for a technical trading signal.
    """
    def post(self, request):
        symbol = request.data.get("symbol", "")
        strategy = request.data.get("strategy", "")
        action = request.data.get("action", "")
        price = float(request.data.get("price", 0.0))
        metadata = request.data.get("metadata", {})

        if not all([symbol, strategy, action]):
            return Response({"error": "Missing required fields: symbol, strategy, action"}, status=status.HTTP_400_BAD_REQUEST)

        explanation = SignalExplainer.explain_signal(
            symbol=symbol,
            strategy=strategy,
            action=action,
            price=price,
            metadata=metadata,
        )
        return Response({"explanation": explanation})


class DailySummaryView(APIView):
    """
    GET /api/assistant/daily-summary/ -> Fetch recent daily performance journals
    POST /api/assistant/daily-summary/ -> Trigger generation of today's EOD summary
    """
    def get(self, request):
        journals = DailyJournal.objects.all()[:7]
        results = []
        for j in journals:
            results.append({
                "id": str(j.id),
                "date": str(j.date),
                "summary": j.summary,
                "total_pnl": float(j.total_pnl),
                "win_rate": j.win_rate,
                "trades_count": j.trades_count,
                "winning_trades": j.winning_trades,
                "losing_trades": j.losing_trades,
                "key_takeaways": j.key_takeaways,
                "created_at": j.created_at.strftime("%Y-%m-%d %H:%M"),
            })
        return Response({"journals": results, "latest": results[0] if results else None})

    def post(self, request):
        send_alerts = bool(request.data.get("send_alerts", False))
        journal = DailyJournalSummarizer.generate_daily_journal(send_alerts=send_alerts)
        return Response({
            "status": "success",
            "journal": {
                "id": str(journal.id),
                "date": str(journal.date),
                "summary": journal.summary,
                "total_pnl": float(journal.total_pnl),
                "win_rate": journal.win_rate,
                "trades_count": journal.trades_count,
                "winning_trades": journal.winning_trades,
                "losing_trades": journal.losing_trades,
                "key_takeaways": journal.key_takeaways,
            },
        })


class SentimentView(APIView):
    """
    GET /api/assistant/sentiment/ -> Fetch current sentiment scores for watchlist
    POST /api/assistant/sentiment/ -> Force refresh sentiment for a specific symbol or all
    """
    def get(self, request):
        symbol = request.query_params.get("symbol")
        if symbol:
            sent = NewsSentimentAnalyzer.analyze_symbol(symbol)
            return Response({
                "symbol": sent.symbol,
                "sentiment": sent.sentiment,
                "score": sent.score,
                "rationale": sent.rationale,
                "headlines": sent.headlines,
                "updated_at": sent.updated_at.strftime("%Y-%m-%d %H:%M"),
            })

        # Fetch watchlist sentiments
        records = StockSentiment.objects.all()
        if not records.exists():
            records = NewsSentimentAnalyzer.refresh_watchlist_sentiment()

        results = [
            {
                "symbol": r.symbol,
                "sentiment": r.sentiment,
                "score": r.score,
                "rationale": r.rationale,
                "headlines": r.headlines[:3],
                "updated_at": r.updated_at.strftime("%Y-%m-%d %H:%M"),
            }
            for r in records
        ]
        return Response(results)

    def post(self, request):
        symbol = request.data.get("symbol")
        if symbol:
            record = NewsSentimentAnalyzer.analyze_symbol(symbol, force_refresh=True)
            return Response({
                "symbol": record.symbol,
                "sentiment": record.sentiment,
                "score": record.score,
                "rationale": record.rationale,
                "headlines": record.headlines,
                "updated_at": record.updated_at.strftime("%Y-%m-%d %H:%M"),
            })

        records = NewsSentimentAnalyzer.refresh_watchlist_sentiment()
        return Response({
            "status": "refreshed",
            "count": len(records),
            "sentiments": [
                {
                    "symbol": r.symbol,
                    "sentiment": r.sentiment,
                    "score": r.score,
                    "rationale": r.rationale,
                }
                for r in records
            ],
        })


class AssistantStatusView(APIView):
    """
    GET /api/assistant/status/
    Returns current status and connectivity of the AI provider and model.
    """
    def get(self, request):
        client = get_ai_client()
        return Response({
            "available": client.is_available(),
            "provider": getattr(client, "provider", "groq"),
            "model": getattr(client, "model", "llama-3.3-70b-versatile"),
            "base_url": getattr(client, "base_url", "https://api.groq.com/openai/v1"),
        })
