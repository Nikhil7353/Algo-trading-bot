from rest_framework import serializers
from core.models import Signal, Order, Position, TradeLog, DailyPerformance


class SignalSerializer(serializers.ModelSerializer):
    class Meta:
        model = Signal
        fields = "__all__"


class OrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = "__all__"


class PositionSerializer(serializers.ModelSerializer):
    unrealized_pnl_pct = serializers.SerializerMethodField()

    class Meta:
        model = Position
        fields = "__all__"

    def get_unrealized_pnl_pct(self, obj):
        if obj.entry_price and obj.entry_price > 0:
            return round(float(obj.current_price - obj.entry_price) / float(obj.entry_price) * 100, 2)
        return 0


class TradeLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = TradeLog
        fields = "__all__"


class DailyPerformanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyPerformance
        fields = "__all__"


class PortfolioSummarySerializer(serializers.Serializer):
    initial_capital = serializers.DecimalField(max_digits=12, decimal_places=2)
    current_capital = serializers.DecimalField(max_digits=12, decimal_places=2)
    open_positions = serializers.IntegerField()
    unrealized_pnl = serializers.DecimalField(max_digits=12, decimal_places=2)
    realized_pnl = serializers.DecimalField(max_digits=12, decimal_places=2)
    total_trades_today = serializers.IntegerField()
    win_rate = serializers.FloatField()
    max_drawdown_pct = serializers.FloatField()


class BacktestRequestSerializer(serializers.Serializer):
    symbol = serializers.CharField(max_length=20)
    strategies = serializers.ListField(
        child=serializers.CharField(),
        default=["ema_crossover"],
    )
    days = serializers.IntegerField(default=504)
    capital = serializers.DecimalField(max_digits=12, decimal_places=2, default=25000)


class BacktestResultSerializer(serializers.Serializer):
    symbol = serializers.CharField()
    period = serializers.CharField()
    initial_capital = serializers.FloatField()
    final_capital = serializers.FloatField()
    total_trades = serializers.IntegerField()
    wins = serializers.IntegerField()
    losses = serializers.IntegerField()
    win_rate = serializers.FloatField()
    total_pnl = serializers.FloatField()
    total_return_pct = serializers.FloatField()
    max_drawdown_pct = serializers.FloatField()
    trades = serializers.ListField()
    equity_curve = serializers.ListField()
