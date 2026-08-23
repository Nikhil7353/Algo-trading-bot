"""Small API-key guard for endpoints that can scan or place trades."""

from hmac import compare_digest

from django.conf import settings
from django.http import JsonResponse


PROTECTED_PATHS = ("/api/execute/", "/api/scan/")


class TradingAPIKeyMiddleware:
    """Require ``X-API-Key`` for market scans and order execution."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path in PROTECTED_PATHS:
            configured_key = settings.STOCKBOT_API_KEY
            supplied_key = request.headers.get("X-API-Key", "")
            if not configured_key:
                return JsonResponse(
                    {"error": "Trading API key is not configured"}, status=503
                )
            if not compare_digest(supplied_key, configured_key):
                return JsonResponse({"error": "Invalid or missing API key"}, status=401)
        return self.get_response(request)
