from django.test import TestCase, override_settings
from decimal import Decimal
from unittest.mock import patch

from core.models import Position


@override_settings(STOCKBOT_API_KEY="test-key")
class TradingAPIKeyMiddlewareTests(TestCase):
    def test_scan_requires_an_api_key(self):
        response = self.client.get("/api/scan/")

        self.assertEqual(response.status_code, 401)

    def test_execute_requires_an_api_key(self):
        response = self.client.post("/api/execute/", data={}, content_type="application/json")

        self.assertEqual(response.status_code, 401)


class PositionListTests(TestCase):
    def test_positions_list_returns_open_lots_when_quotes_fail(self):
        Position.objects.create(
            symbol="SBIN",
            side="LONG",
            quantity=5,
            entry_price=Decimal("1048.70"),
            current_price=Decimal("1048.70"),
            stop_loss=Decimal("1027.73"),
            take_profit=Decimal("1090.65"),
            unrealized_pnl=Decimal("0"),
            is_open=True,
        )

        with patch("api.views.DataFetcher") as mock_fetcher:
            mock_fetcher.return_value.fetch_live_price.side_effect = Exception("network")
            response = self.client.get("/api/positions/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        rows = payload["results"] if isinstance(payload, dict) else payload
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["symbol"], "SBIN")
