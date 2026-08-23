import json
import logging
import os
import urllib.parse
import urllib.request
from pathlib import Path
import yaml
from dotenv import load_dotenv

logger = logging.getLogger("stockbot.alerts.whatsapp")

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = BASE_DIR / "config" / "settings.yaml"
load_dotenv(BASE_DIR / ".env")


def _load_whatsapp_config() -> tuple[str, str, bool]:
    """
    Returns (phone, api_key, enabled).
    Prioritizes secure environment variables (.env) over config/settings.yaml.
    """
    phone = os.getenv("WHATSAPP_PHONE", "").strip().replace("+", "").replace(" ", "").replace("-", "")
    api_key = os.getenv("WHATSAPP_API_KEY", "").strip()
    env_enabled = os.getenv("WHATSAPP_ENABLED", "").strip().lower()

    enabled = env_enabled in ("true", "1", "yes") if env_enabled else False

    # Fallback to settings.yaml if not in .env
    if CONFIG_PATH.exists() and (not phone or not api_key):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
                wa_cfg = cfg.get("whatsapp", {})
                if not phone:
                    phone = str(wa_cfg.get("phone", "")).strip().replace("+", "").replace(" ", "").replace("-", "")
                if not api_key:
                    api_key = str(wa_cfg.get("api_key", "")).strip()
                if not env_enabled and "enabled" in wa_cfg:
                    enabled = bool(wa_cfg.get("enabled", False))
        except Exception as e:
            logger.error("Error loading WhatsApp config from YAML: %s", e)

    return phone, api_key, enabled


def send_whatsapp_message(message: str) -> bool:
    """
    Sends a WhatsApp message via CallMeBot API.
    Safe and non-blocking — logs errors without raising exceptions.
    """
    phone, api_key, enabled = _load_whatsapp_config()

    if not enabled or not phone or not api_key:
        logger.debug("WhatsApp alerts not enabled or credentials missing. Skipping.")
        return False

    encoded_text = urllib.parse.quote(message)
    url = f"https://api.callmebot.com/whatsapp.php?phone={phone}&text={encoded_text}&apikey={api_key}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "StockBot/2.0"})
        with urllib.request.urlopen(req, timeout=8) as response:
            res_body = response.read().decode("utf-8")
            if "Message queued" in res_body or "Success" in res_body or response.status == 200:
                logger.info("WhatsApp notification sent successfully.")
                return True
            else:
                logger.warning(f"WhatsApp API response: {res_body}")
                return False
    except Exception as e:
        logger.warning(f"Failed to send WhatsApp alert: {e}")
        return False


def send_whatsapp_trade_alert(symbol: str, side: str, qty: int, price: float, stop_loss: float, take_profit: float, mode: str = "Paper") -> bool:
    side_emoji = "🟢 BUY" if side.upper() == "BUY" else "🔴 SELL"
    msg = (
        f"⚡ StockBot Trade Alert ({mode.upper()})\n\n"
        f"Order: {side_emoji} {qty} share(s) of {symbol}\n"
        f"💵 Price: ₹{price:,.2f}\n"
        f"🛑 Stop Loss: ₹{stop_loss:,.2f} (-2%)\n"
        f"🎯 Take Profit: ₹{take_profit:,.2f} (+4%)\n\n"
        f"🛡️ Active risk management engaged."
    )
    return send_whatsapp_message(msg)


def send_whatsapp_position_closed_alert(symbol: str, pnl: float, pnl_pct: float, reason: str = "Target / Stop-Loss") -> bool:
    tone = "🎉 PROFIT BOOKED" if pnl >= 0 else "🛑 STOP-LOSS CUT"
    msg = (
        f"⚡ StockBot Position Closed\n\n"
        f"{tone} for {symbol}\n"
        f"💵 P&L: ₹{pnl:+,.2f} ({pnl_pct:+.2f}%)\n"
        f"📌 Trigger: {reason}\n\n"
        f"Updated in StockBot Dashboard."
    )
    return send_whatsapp_message(msg)
