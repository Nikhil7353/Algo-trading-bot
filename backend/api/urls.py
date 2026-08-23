from django.urls import path, include
from rest_framework.routers import DefaultRouter
from api import views

router = DefaultRouter()
router.register(r"signals", views.SignalViewSet)
router.register(r"orders", views.OrderViewSet)
router.register(r"positions", views.PositionViewSet)
router.register(r"trades", views.TradeLogViewSet)
router.register(r"performance", views.DailyPerformanceViewSet)

urlpatterns = [
    path("", include(router.urls)),
    path("portfolio/", views.PortfolioView.as_view(), name="portfolio"),
    path("scan/", views.ScanView.as_view(), name="scan"),
    path("execute/", views.ExecuteView.as_view(), name="execute"),
    path("backtest/", views.BacktestView.as_view(), name="backtest"),
    path("backtest/watchlist/", views.BacktestWatchlistView.as_view(), name="backtest-watchlist"),
    path("strategies/", views.StrategiesView.as_view(), name="strategies"),
    path("emergency-squareoff/", views.EmergencySquareOffView.as_view(), name="emergency-squareoff"),
    path("scan-watchlist/", views.WatchlistScanView.as_view(), name="scan-watchlist"),
    path("settings/", views.SettingsView.as_view(), name="settings"),
    path("telegram-test/", views.TelegramTestView.as_view(), name="telegram-test"),
    path("whatsapp-test/", views.WhatsAppTestView.as_view(), name="whatsapp-test"),
    path("autotrader/status/", views.AutoTraderStatusView.as_view(), name="autotrader-status"),
    path("autotrader/toggle/", views.AutoTraderToggleView.as_view(), name="autotrader-toggle"),
    path("trades-calendar/", views.CalendarPnLView.as_view(), name="trades-calendar"),
]
