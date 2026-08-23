from django.test import TestCase

from core.models import Order
from execution.executor import OrderExecutor


class OrderExecutorTests(TestCase):
    def test_paper_order_is_saved_with_a_valid_uuid(self):
        order_id = OrderExecutor().place_order("TCS", "BUY", 1, 100.0)

        self.assertIsNotNone(order_id)
        order = Order.objects.get(broker_order_id=f"PAPER-{order_id}")
        self.assertEqual(order.status, "EXECUTED")
