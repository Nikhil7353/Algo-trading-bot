import logging
from datetime import datetime
from pathlib import Path


class TradeLogger:
    def __init__(self, name="stockbot", log_dir="logs"):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(exist_ok=True)

        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.INFO)

        fh = logging.FileHandler(self.log_dir / f"{name}.log")
        ch = logging.StreamHandler()

        fmt = logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
        fh.setFormatter(fmt)
        ch.setFormatter(fmt)

        if not self.logger.handlers:
            self.logger.addHandler(fh)
            self.logger.addHandler(ch)

    def log_signal(self, strategy, symbol, signal, price, metadata=None):
        msg = f"SIGNAL | {strategy} | {symbol} | {signal} | Rs{price}"
        if metadata:
            msg += f" | {metadata}"
        self.logger.info(msg)

    def log_order(self, order_id, symbol, side, qty, price, status):
        self.logger.info(f"ORDER | {order_id} | {symbol} | {side} | qty={qty} | Rs{price} | {status}")

    def log_position(self, symbol, qty, entry_price, pnl=0):
        self.logger.info(f"POSITION | {symbol} | qty={qty} | entry=Rs{entry_price} | pnl=Rs{pnl:.2f}")

    def log_risk(self, msg, level="WARNING"):
        self.logger.warning(f"RISK | {msg}")

    def log_error(self, context, error):
        self.logger.error(f"ERROR | {context} | {error}", exc_info=True)


trade_log = TradeLogger()
