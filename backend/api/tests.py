from django.test import TestCase, override_settings


@override_settings(STOCKBOT_API_KEY="test-key")
class TradingAPIKeyMiddlewareTests(TestCase):
    def test_scan_requires_an_api_key(self):
        response = self.client.get("/api/scan/")

        self.assertEqual(response.status_code, 401)

    def test_execute_requires_an_api_key(self):
        response = self.client.post("/api/execute/", data={}, content_type="application/json")

        self.assertEqual(response.status_code, 401)
