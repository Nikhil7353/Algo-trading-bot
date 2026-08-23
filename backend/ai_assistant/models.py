import uuid
from django.db import models


class DailyJournal(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    date = models.DateField(unique=True)
    summary = models.TextField()
    total_pnl = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    win_rate = models.FloatField(default=0.0)
    trades_count = models.IntegerField(default=0)
    winning_trades = models.IntegerField(default=0)
    losing_trades = models.IntegerField(default=0)
    key_takeaways = models.JSONField(default=list, blank=True)
    sent_to_alerts = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return f"Daily Journal for {self.date} (P&L: Rs{self.total_pnl}, Win Rate: {self.win_rate:.1f}%)"


class StockSentiment(models.Model):
    SENTIMENT_CHOICES = [
        ("BULLISH", "Bullish"),
        ("NEUTRAL", "Neutral"),
        ("BEARISH", "Bearish"),
    ]

    symbol = models.CharField(max_length=20, primary_key=True)
    sentiment = models.CharField(max_length=10, choices=SENTIMENT_CHOICES, default="NEUTRAL")
    score = models.FloatField(default=0.0)  # -1.0 to +1.0
    rationale = models.TextField(blank=True)
    headlines = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.symbol}: {self.sentiment} ({self.score:+.2f}) - {self.rationale[:50]}"
