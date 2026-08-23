from django.db import models
import uuid


class Signal(models.Model):
    ACTIONS = [("BUY", "Buy"), ("SELL", "Sell"), ("HOLD", "Hold")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    symbol = models.CharField(max_length=20)
    strategy = models.CharField(max_length=50)
    action = models.CharField(max_length=4, choices=ACTIONS)
    price = models.DecimalField(max_digits=12, decimal_places=2)
    strength = models.FloatField(default=0.0)
    metadata_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.action} {self.symbol} @ Rs{self.price} ({self.strategy})"


class Order(models.Model):
    STATUSES = [
        ("PENDING", "Pending"),
        ("EXECUTED", "Executed"),
        ("CANCELLED", "Cancelled"),
        ("REJECTED", "Rejected"),
        ("FAILED", "Failed"),
    ]
    SIDES = [("BUY", "Buy"), ("SELL", "Sell")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    broker_order_id = models.CharField(max_length=50, blank=True)
    symbol = models.CharField(max_length=20)
    side = models.CharField(max_length=4, choices=SIDES)
    quantity = models.IntegerField()
    price = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=10, choices=STATUSES, default="PENDING")
    mode = models.CharField(max_length=10, default="paper")  # paper | live
    signal = models.ForeignKey(Signal, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    executed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.side} {self.quantity}x {self.symbol} @ Rs{self.price} [{self.status}]"


class Position(models.Model):
    SIDES = [("LONG", "Long"), ("SHORT", "Short")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    symbol = models.CharField(max_length=20, unique=True)
    side = models.CharField(max_length=5, choices=SIDES)
    quantity = models.IntegerField()
    entry_price = models.DecimalField(max_digits=12, decimal_places=2)
    current_price = models.DecimalField(max_digits=12, decimal_places=2)
    stop_loss = models.DecimalField(max_digits=12, decimal_places=2)
    take_profit = models.DecimalField(max_digits=12, decimal_places=2)
    unrealized_pnl = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    is_open = models.BooleanField(default=True)
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-opened_at"]

    def __str__(self):
        status = "OPEN" if self.is_open else "CLOSED"
        return f"{self.side} {self.quantity}x {self.symbol} | P&L: Rs{self.unrealized_pnl} [{status}]"


class TradeLog(models.Model):
    PNL_TYPES = [("REALIZED", "Realized"), ("UNREALIZED", "Unrealized")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    symbol = models.CharField(max_length=20)
    side = models.CharField(max_length=4)
    quantity = models.IntegerField()
    entry_price = models.DecimalField(max_digits=12, decimal_places=2)
    exit_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    pnl = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    pnl_pct = models.FloatField(default=0)
    strategy = models.CharField(max_length=50)
    pnl_type = models.CharField(max_length=10, choices=PNL_TYPES, default="REALIZED")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.side} {self.symbol} | P&L: Rs{self.pnl} ({self.pnl_pct:.1f}%)"


class DailyPerformance(models.Model):
    date = models.DateField(unique=True)
    starting_capital = models.DecimalField(max_digits=12, decimal_places=2)
    ending_capital = models.DecimalField(max_digits=12, decimal_places=2)
    total_trades = models.IntegerField(default=0)
    winning_trades = models.IntegerField(default=0)
    losing_trades = models.IntegerField(default=0)
    realized_pnl = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    max_drawdown_pct = models.FloatField(default=0)
    win_rate = models.FloatField(default=0)

    def __str__(self):
        return f"{self.date} | P&L: Rs{self.realized_pnl} | Win Rate: {self.win_rate:.1f}%"
