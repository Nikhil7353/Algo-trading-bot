import threading
import time
import uuid
from decimal import Decimal
from typing import Optional, Dict, Any, List

from django.utils import timezone

from core.config import get_settings
from core.logger import trade_log
from core.models import Order, Signal


class OrderExecutor:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self.settings = get_settings()
        self._client = None
        self._poller_thread: Optional[threading.Thread] = None
        self._stop_poller = threading.Event()
        self._reconcile_lock = threading.Lock()

        if self.settings.mode == "live":
            self._connect_angel()
            self.start_reconciliation_poller()

    def _connect_angel(self):
        try:
            from SmartApi import SmartConnect
            import pyotp

            if not self.settings.angel_api_key:
                trade_log.logger.warning("Angel One API key not configured for executor")
                return

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

    def start_reconciliation_poller(self, interval_seconds: int = 5):
        """Start the background daemon thread that reconciles pending live orders against orderBook."""
        with self._lock:
            if self._poller_thread and self._poller_thread.is_alive():
                return
            self._stop_poller.clear()
            self._poller_thread = threading.Thread(
                target=self._reconciliation_loop,
                args=(interval_seconds,),
                daemon=True,
                name="OrderReconciliationDaemon",
            )
            self._poller_thread.start()
            trade_log.logger.info("Order reconciliation daemon started (polling every %ds)", interval_seconds)

    def stop_reconciliation_poller(self):
        self._stop_poller.set()

    def _reconciliation_loop(self, interval_seconds: int):
        while not self._stop_poller.is_set():
            try:
                if self.settings.mode == "live" and self._client is not None:
                    self.reconcile_orders()
            except Exception as e:
                trade_log.logger.warning("Order reconciliation cycle error: %s", e)
            self._stop_poller.wait(timeout=interval_seconds)

    def place_order(self, symbol: str, side: str, quantity: int, price: float, signal_id=None) -> Optional[str]:
        order_id = str(uuid.uuid4())[:8]

        if self.settings.mode == "paper":
            return self._paper_execute(symbol, side, quantity, price, order_id, signal_id)

        return self._live_execute(symbol, side, quantity, price, order_id, signal_id)

    def _paper_execute(self, symbol, side, quantity, price, order_id, signal_id=None):
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
            filled_quantity=quantity,
            average_price=Decimal(str(price)),
            status="EXECUTED",
            mode="paper",
            signal=db_signal,
            executed_at=timezone.now(),
        )
        trade_log.log_order(order_id, symbol, side, quantity, price, "PAPER_EXECUTED")
        return order_id

    def _live_execute(self, symbol, side, quantity, price, order_id, signal_id=None):
        if self._client is None:
            self._connect_angel()
            if self._client is None:
                trade_log.logger.error("Cannot place live order: Angel One SmartAPI client not connected")
                return None

        try:
            params = {
                "variety": "NORMAL",
                "tradingsymbol": f"{symbol}-EQ" if not symbol.endswith(("-EQ", ".NS")) else symbol,
                "transactiontype": side.upper(),
                "exchange": "NSE",
                "ordertype": "LIMIT",
                "producttype": "INTRADAY",
                "duration": "DAY",
                "quantity": str(quantity),
                "price": str(price),
                "squareoff": "0",
                "stoploss": "0",
            }
            res = self._client.placeOrder(params)

            broker_id = str(res)
            if isinstance(res, dict):
                broker_id = str(res.get("data", {}).get("orderid") or res.get("orderid") or "")

            if not broker_id:
                trade_log.logger.error("Angel placeOrder failed: Empty broker order ID returned: %s", res)
                return None

            db_signal = None
            if signal_id:
                try:
                    db_signal = Signal.objects.get(id=signal_id)
                except Signal.DoesNotExist:
                    pass

            # Initial status is PENDING — reconciler will confirm execution
            Order.objects.create(
                id=uuid.uuid4(),
                broker_order_id=broker_id,
                symbol=symbol,
                side=side.upper(),
                quantity=quantity,
                price=Decimal(str(price)),
                filled_quantity=0,
                average_price=Decimal("0.0"),
                status="PENDING",
                mode="live",
                signal=db_signal,
            )
            trade_log.log_order(broker_id, symbol, side, quantity, price, "LIVE_PENDING_PLACED")

            # Ensure background reconciliation is running
            self.start_reconciliation_poller()
            return broker_id
        except Exception as e:
            trade_log.log_error(f"Live order placement {order_id}", e)
        return None

    def reconcile_orders(self) -> Dict[str, int]:
        """
        Polls Angel One orderBook() and updates all PENDING / PARTIALLY_FILLED orders.
        Synchronizes confirmed fills into RiskManager positions & TradeLog.
        """
        with self._reconcile_lock:
            pending_orders = Order.objects.filter(mode="live", status__in=["PENDING", "PARTIALLY_FILLED"])
            if not pending_orders.exists():
                return {"pending": 0, "updated": 0}

            if self._client is None:
                self._connect_angel()
                if self._client is None:
                    return {"pending": pending_orders.count(), "updated": 0}

            try:
                res = self._client.orderBook()
                if not res or not res.get("status") or "data" not in res:
                    return {"pending": pending_orders.count(), "updated": 0}

                broker_orders = {str(item.get("orderid")): item for item in (res.get("data") or []) if "orderid" in item}
                updated_count = 0

                for db_order in pending_orders:
                    broker_item = broker_orders.get(db_order.broker_order_id)
                    if not broker_item:
                        continue

                    raw_status = str(broker_item.get("status") or broker_item.get("orderstatus") or "").lower().strip()
                    filled_shares = int(broker_item.get("filledshares") or 0)
                    avg_price = float(broker_item.get("averageprice") or broker_item.get("price") or db_order.price)
                    rejection_text = str(broker_item.get("text") or broker_item.get("rejectionreason") or "")

                    new_status = db_order.status
                    if raw_status in ("complete", "executed", "traded") or filled_shares >= db_order.quantity:
                        new_status = "EXECUTED"
                    elif raw_status in ("cancelled", "user cancelled"):
                        new_status = "CANCELLED"
                    elif raw_status in ("rejected", "validation error"):
                        new_status = "REJECTED"
                    elif raw_status in ("partially filled", "partial") or (0 < filled_shares < db_order.quantity):
                        new_status = "PARTIALLY_FILLED"

                    if new_status != db_order.status or filled_shares != db_order.filled_quantity:
                        old_status = db_order.status
                        db_order.status = new_status
                        db_order.filled_quantity = filled_shares
                        db_order.average_price = Decimal(str(avg_price)) if avg_price > 0 else db_order.price
                        db_order.rejection_reason = rejection_text

                        if new_status == "EXECUTED":
                            db_order.executed_at = timezone.now()
                            db_order.save()
                            self._on_live_order_executed(db_order)
                            trade_log.log_order(db_order.broker_order_id, db_order.symbol, db_order.side, db_order.filled_quantity, float(db_order.average_price), "LIVE_EXECUTED_CONFIRMED")
                        elif new_status in ("REJECTED", "CANCELLED"):
                            db_order.save()
                            trade_log.log_risk(f"Live order {db_order.broker_order_id} for {db_order.symbol} was {new_status}: {rejection_text}")
                        else:
                            db_order.save()

                        updated_count += 1
                        trade_log.logger.info("Order %s updated: %s -> %s (Filled: %d/%d @ Rs%.2f)", db_order.broker_order_id, old_status, new_status, filled_shares, db_order.quantity, avg_price)

                return {"pending": pending_orders.count(), "updated": updated_count}
            except Exception as e:
                trade_log.log_error("Order Reconciliation", e)
                return {"pending": pending_orders.count(), "updated": 0}

    def _on_live_order_executed(self, order: Order):
        """Called when a live order is confirmed EXECUTED by the broker."""
        try:
            from risk.manager import get_risk_manager
            rm = get_risk_manager()
            fill_price = float(order.average_price) if order.average_price > 0 else float(order.price)
            fill_qty = order.filled_quantity if order.filled_quantity > 0 else order.quantity

            if order.side == "BUY":
                pos = rm.open_position(
                    symbol=order.symbol,
                    side="BUY",
                    qty=fill_qty,
                    price=fill_price,
                    now=order.executed_at,
                )
                try:
                    from alerts.telegram import send_trade_executed_alert
                    from alerts.whatsapp import send_whatsapp_trade_alert
                    send_trade_executed_alert(pos.symbol, pos.side, pos.quantity, pos.entry_price, pos.stop_loss, pos.take_profit, mode="Live")
                    send_whatsapp_trade_alert(pos.symbol, pos.side, pos.quantity, pos.entry_price, pos.stop_loss, pos.take_profit, mode="Live")
                except Exception as alert_err:
                    trade_log.logger.warning("Alert dispatch error on live fill: %s", alert_err)

            elif order.side == "SELL":
                pnl = rm.close_position(
                    symbol=order.symbol,
                    exit_price=fill_price,
                    now=order.executed_at,
                )
                try:
                    from alerts.telegram import send_position_closed_alert
                    from alerts.whatsapp import send_whatsapp_position_closed_alert
                    pnl_val = pnl if pnl is not None else 0.0
                    send_position_closed_alert(order.symbol, pnl_val, 0.0, reason="Live Broker Fill")
                    send_whatsapp_position_closed_alert(order.symbol, pnl_val, 0.0, reason="Live Broker Fill")
                except Exception as alert_err:
                    trade_log.logger.warning("Alert dispatch error on live close: %s", alert_err)
        except Exception as e:
            trade_log.log_error(f"Downstream sync for order {order.broker_order_id}", e)

    def get_paper_orders(self):
        return Order.objects.filter(mode="paper").order_by("-created_at")

    def get_pending_live_orders(self):
        return Order.objects.filter(mode="live", status__in=["PENDING", "PARTIALLY_FILLED"]).order_by("-created_at")


executor = OrderExecutor()
