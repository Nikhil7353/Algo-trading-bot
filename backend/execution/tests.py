from decimal import Decimal
from unittest.mock import MagicMock
from django.test import TestCase

from core.models import Order, Position
from execution.executor import OrderExecutor
from risk.manager import RiskManager, get_risk_manager


class OrderExecutorTests(TestCase):
    def test_paper_order_is_saved_with_a_valid_uuid(self):
        order_id = OrderExecutor().place_order("TCS", "BUY", 1, 100.0)

        self.assertIsNotNone(order_id)
        order = Order.objects.get(broker_order_id=f"PAPER-{order_id}")
        self.assertEqual(order.status, "EXECUTED")
        self.assertEqual(order.filled_quantity, 1)
        self.assertEqual(order.average_price, Decimal("100.0"))

    def test_reconcile_orders_updates_pending_to_executed_and_opens_position(self):
        executor = OrderExecutor()
        executor.settings.mode = "live"

        # Create a pending live order in DB
        pending_order = Order.objects.create(
            broker_order_id="ANGEL-12345",
            symbol="INFY",
            side="BUY",
            quantity=10,
            price=Decimal("1500.00"),
            status="PENDING",
            mode="live",
        )

        # Mock Angel One SmartConnect client orderBook response
        mock_client = MagicMock()
        mock_client.orderBook.return_value = {
            "status": True,
            "message": "SUCCESS",
            "data": [
                {
                    "orderid": "ANGEL-12345",
                    "status": "complete",
                    "filledshares": "10",
                    "unfilledshares": "0",
                    "averageprice": 1498.50,
                    "text": "",
                }
            ],
        }
        executor._client = mock_client

        # Run reconciliation
        res = executor.reconcile_orders()
        self.assertEqual(res["updated"], 1)

        # Verify DB order updated
        pending_order.refresh_from_db()
        self.assertEqual(pending_order.status, "EXECUTED")
        self.assertEqual(pending_order.filled_quantity, 10)
        self.assertEqual(pending_order.average_price, Decimal("1498.50"))
        self.assertIsNotNone(pending_order.executed_at)

        # Verify Position was created for confirmed fill
        pos = Position.objects.filter(symbol="INFY", is_open=True).first()
        self.assertIsNotNone(pos)
        self.assertEqual(pos.quantity, 10)
        self.assertEqual(pos.entry_price, Decimal("1498.50"))

    def test_reconcile_orders_handles_rejected_order(self):
        executor = OrderExecutor()
        executor.settings.mode = "live"

        pending_order = Order.objects.create(
            broker_order_id="ANGEL-REJ-999",
            symbol="RELIANCE",
            side="BUY",
            quantity=5,
            price=Decimal("2800.00"),
            status="PENDING",
            mode="live",
        )

        mock_client = MagicMock()
        mock_client.orderBook.return_value = {
            "status": True,
            "data": [
                {
                    "orderid": "ANGEL-REJ-999",
                    "status": "rejected",
                    "filledshares": "0",
                    "text": "Insufficient Margin in account",
                }
            ],
        }
        executor._client = mock_client

        res = executor.reconcile_orders()
        self.assertEqual(res["updated"], 1)

        pending_order.refresh_from_db()
        self.assertEqual(pending_order.status, "REJECTED")
        self.assertEqual(pending_order.rejection_reason, "Insufficient Margin in account")

        # Confirm no position was opened
        pos = Position.objects.filter(symbol="RELIANCE", is_open=True).first()
        self.assertIsNone(pos)
