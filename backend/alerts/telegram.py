import json
import logging
import urllib.request
import urllib.parse
from pathlib import Path
import yaml

logger = logging.getLogger("stockbot.alerts")

CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "settings.yaml"


def _load_telegram_config() -> tuple[str, str, bool]:
    """Returns (bot_token, chat_id, enabled) from settings.yaml or environment."""
    if not CONFIG_PATH.exists():
        return "", "", False

    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
            tg_cfg = cfg.get("telegram", {})
            token = str(tg_cfg.get("bot_token", "")).strip()
            chat_id = str(tg_cfg.get("chat_id", "")).strip()
            enabled = bool(tg_cfg.get("enabled", False))
            return token, chat_id, enabled
    except Exception as e:
        logger.error(f"Error loading telegram config: {e}")
        return "", "", False


def send_telegram_message(message: str, parse_mode: str = "HTML") -> bool:
    """
    Sends a formatted notification message to the configured Telegram chat.
    Safe and non-blocking — logs errors without raising exceptions.
    """
    bot_token, chat_id, enabled = _load_telegram_config()

    if not enabled or not bot_token or not chat_id:
        logger.debug("Telegram alerts not enabled or credentials missing. Skipping.")
        return False

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True,
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            res_body = json.loads(response.read().decode("utf-8"))
            if res_body.get("ok"):
                logger.info("Telegram notification sent successfully.")
                return True
            else:
                logger.warning(f"Telegram API returned error: {res_body}")
                return False
    except Exception as e:
        logger.warning(f"Failed to send Telegram alert: {e}")
        return False


def send_signal_alert(symbol: str, action: str, price: float, strategy: str, confidence: float, reason: str = "") -> bool:
    emoji = "🟢 <b>BUY SIGNAL</b>" if action.upper() == "BUY" else "🔴 <b>SELL SIGNAL</b>"
    msg = (
        f"⚡ <b>StockBot Opportunity Alert</b>\n\n"
        f"{emoji} for <b>{symbol}</b>\n"
        f"💰 <b>Price:</b> ₹{price:,.2f}\n"
        f"🎯 <b>Strategy:</b> {strategy}\n"
        f"📊 <b>Confidence:</b> {confidence * 100:.0f}%\n"
    )
    if reason:
        msg += f"📝 <b>Reason:</b> {reason}\n"
    msg += "\n<i>Execute on StockBot Dashboard</i>"
    return send_telegram_message(msg)


def send_trade_executed_alert(symbol: str, side: str, qty: int, price: float, stop_loss: float, take_profit: float, mode: str = "Paper") -> bool:
    emoji = "🟢 <b>ORDER EXECUTED (BUY)</b>" if side.upper() == "BUY" else "🔴 <b>ORDER EXECUTED (SELL)</b>"
    msg = (
        f"⚡ <b>StockBot Trade Execution ({mode.upper()})</b>\n\n"
        f"{emoji}\n"
        f"📈 <b>Symbol:</b> {symbol}\n"
        f"🔢 <b>Quantity:</b> {qty} share(s)\n"
        f"💵 <b>Execution Price:</b> ₹{price:,.2f}\n"
        f"🛑 <b>Stop Loss:</b> ₹{stop_loss:,.2f} (-2%)\n"
        f"🎯 <b>Take Profit:</b> ₹{take_profit:,.2f} (+4%)\n\n"
        f"🛡️ <i>Active risk protection engaged</i>"
    )
    return send_telegram_message(msg)


def send_position_closed_alert(symbol: str, pnl: float, pnl_pct: float, reason: str = "Target / Stop-Loss Hit") -> bool:
    emoji = "🎉 <b>PROFIT BOOKED</b>" if pnl >= 0 else "🛑 <b>STOP-LOSS CUT</b>"
    tone_color = "🟢" if pnl >= 0 else "🔴"
    msg = (
        f"{tone_color} <b>StockBot Position Closed</b>\n\n"
        f"{emoji} for <b>{symbol}</b>\n"
        f"💵 <b>P&L:</b> ₹{pnl:+,.2f} ({pnl_pct:+.2f}%)\n"
        f"📌 <b>Trigger:</b> {reason}\n\n"
        f"<i>Updated in Trade History</i>"
    )
    return send_telegram_message(msg)
