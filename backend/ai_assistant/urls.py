from django.urls import path
from ai_assistant.views import (
    AssistantStatusView,
    ChatAssistantView,
    DailySummaryView,
    SentimentView,
    SignalExplanationView,
)

urlpatterns = [
    path("chat/", ChatAssistantView.as_view(), name="assistant-chat"),
    path("explain-signal/", SignalExplanationView.as_view(), name="assistant-explain-signal"),
    path("daily-summary/", DailySummaryView.as_view(), name="assistant-daily-summary"),
    path("sentiment/", SentimentView.as_view(), name="assistant-sentiment"),
    path("status/", AssistantStatusView.as_view(), name="assistant-status"),
]
