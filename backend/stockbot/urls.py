from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/assistant/", include("ai_assistant.urls")),
    path("api/", include("api.urls")),
]
