import uuid
from typing import Optional

from django.utils import timezone

from core.config import get_settings
from core.logger import trade_log


class OrderExecutor:
    def __init__(self):
        self.settings = get_settings()
        self._client = None
        self._paper_orders = []

        if self.settings.mode == "live":
            self._connect_angel()

    def _connect_angel(self):
        try:
            from SmartApi import SmartConnect
            import pyotp

            self._client = SmartConnect(self.settings.angel_api_key)
            totp = pyotp.TOTP(self.settings.angel_totp_secret).now()
            data = self._client.generateSession(
                self.settings.angel_client_id,
                self.settings.angel_password,
                totp,
            )
            if data.get("status"):
                trade_log.logger.info("OrderExecutor connected to Angel One")
            else:
                trade_log.log_error("Executor Auth", Exception(data.get("message", "Failed")))
        except Exception as e:
            trade_log.log_error("Executor Connection", e)

    def place_order(self, symbol: str, side: str, quantity: int, price: float, signal_id=None) -> Optional[str]:
        order_id = str(uuid.uuid4())[:8]

        if self.settings.mode == "paper":
            return self._paper_execute(symbol, side, quantity, price, order_id, signal_id)

        return self._live_execute(symbol, side, quantity, price, order_id)

    def _paper_execute(self, symbol, side, quantity, price, order_id, signal_id=None):
        from core.models import Order, Signal

        db_signal = None
        if signal_id:
            try:
                db_signal = Signal.objects.get(id=signal_id)
            except Signal.DoesNotExist:
                pass

        Order.objects.create(
            id=uuid.uuid4(),
            broker_order_id=f"PAPER-{order_id}",
            symbol=symbol,
            side=side,
            quantity=quantity,
            price=price,
            status="EXECUTED",
            mode="paper",
            signal=db_signal,
            executed_at=timezone.now(),
        )
        trade_log.log_order(order_id, symbol, side, quantity, price, "PAPER_EXECUTED")
        return order_id

    def _live_execute(self, symbol, side, quantity, price, order_id):
        try:
            from SmartApi import SmartConnect

            params = {
                "variety": "NORMAL",
                "tradingsymbol": symbol,
                "transactiontype": side,
                "exchange": "NSE",
                "ordertype": "LIMIT",
                "producttype": "INTRADAY",
                "duration": "DAY",
                "quantity": str(quantity),
                "price": str(price),
                "squareoff": "0",
                "stoploss": "0",
            }
            broker_id = self._client.placeOrder(params)

            from core.models import Order
            Order.objects.create(
                id=uuid.uuid4(),
                broker_order_id=broker_id,
                symbol=symbol,
                side=side,
                quantity=quantity,
                price=price,
                status="EXECUTED",
                mode="live",
                executed_at=timezone.now(),
            )
            trade_log.log_order(broker_id, symbol, side, quantity, price, "LIVE_PLACED")
            return broker_id
        except Exception as e:
            trade_log.log_error(f"Live order {order_id}", e)
        return None

    def get_paper_orders(self):
        from core.models import Order
        return Order.objects.filter(mode="paper").order_by("-created_at")
