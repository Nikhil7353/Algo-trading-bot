from django.test import TestCase

from risk.manager import RiskManager


class RiskManagerTests(TestCase):
    def test_close_uses_exit_price_for_realized_pnl(self):
        manager = RiskManager(capital=1_000)
        manager.open_position("TCS", "BUY", 2, 100)

        pnl = manager.close_position("TCS", 110)

        self.assertEqual(pnl, 20)
        self.assertEqual(manager.daily_pnl, 20)

    def test_sell_uses_the_open_position_quantity(self):
        manager = RiskManager(capital=1_000)
        manager.max_open_positions = 1
        manager.open_position("TCS", "BUY", 2, 100)

        approved, quantity, reason = manager.validate_signal("TCS", "SELL", 110)

        self.assertTrue(approved, reason)
        self.assertEqual(quantity, 2)
