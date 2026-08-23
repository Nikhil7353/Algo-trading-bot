from rest_framework import viewsets, status
from rest_framework.decorators import api_view, action
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Signal, Order, Position, TradeLog, DailyPerformance
from api.serializers import (
    SignalSerializer, OrderSerializer, PositionSerializer,
    TradeLogSerializer, DailyPerformanceSerializer,
    BacktestRequestSerializer, BacktestResultSerializer,
)
from core.config import get_settings
from core.logger import trade_log
from data.fetcher import DataFetcher
from strategies.engine import StrategyEngine
from risk.manager import get_risk_manager
from execution.executor import OrderExecutor
from backtesting.engine import BacktestEngine


class SignalViewSet(viewsets.ModelViewSet):
    queryset = Signal.objects.all()
    serializer_class = SignalSerializer


class OrderViewSet(viewsets.ModelViewSet):
    queryset = Order.objects.all()
    serializer_class = OrderSerializer


class PositionViewSet(viewsets.ModelViewSet):
    queryset = Position.objects.all()
    serializer_class = PositionSerializer


class TradeLogViewSet(viewsets.ModelViewSet):
    queryset = TradeLog.objects.all()
    serializer_class = TradeLogSerializer


class DailyPerformanceViewSet(viewsets.ModelViewSet):
    queryset = DailyPerformance.objects.all()
    serializer_class = DailyPerformanceSerializer


class PortfolioView(APIView):
    def get(self, request):
        rm = get_risk_manager()
        summary = rm.get_portfolio_summary()
        return Response(summary)


import math


def _safe_float(val, default=0.0):
    try:
        f = float(val)
        return default if math.isnan(f) or math.isinf(f) else round(f, 2)
    except Exception:
        return default


class ScanView(APIView):
    def get(self, request):
        settings = get_settings()
        fetcher = DataFetcher()
        engine = StrategyEngine()

        requested_symbol = request.query_params.get("symbol", "").upper().strip()
        symbols_to_scan = [requested_symbol] if requested_symbol else settings.watchlist

        results = []
        for symbol in symbols_to_scan:
            data = fetcher.fetch_historical(symbol)
            if not data.empty:
                data = data.dropna(subset=["open", "high", "low", "close"])
                signals = engine.analyze(symbol, data)
                for sig in signals:
                    explanation = ""
                    try:
                        from ai_assistant.services import SignalExplainer
                        explanation = SignalExplainer.explain_signal(
                            symbol=sig.symbol,
                            strategy=sig.strategy,
                            action=sig.action,
                            price=_safe_float(sig.price),
                            metadata=sig.metadata or {},
                        )
                    except Exception:
                        pass

                    Signal.objects.create(
                        symbol=sig.symbol,
                        strategy=sig.strategy,
                        action=sig.action,
                        price=_safe_float(sig.price),
                        strength=_safe_float(sig.strength, 0.8),
                        explanation=explanation,
                        metadata_json=sig.metadata or {},
                    )

                candles = []
                for idx, row in data.tail(40).iterrows():
                    d_str = str(row.get("date", idx)).split(" ")[0]
                    o = _safe_float(row["open"])
                    h = _safe_float(row["high"])
                    l = _safe_float(row["low"])
                    c = _safe_float(row["close"])
                    v = _safe_float(row.get("volume", 0), 0)
                    candles.append({
                        "date": d_str,
                        "open": o,
                        "high": h,
                        "low": l,
                        "close": c,
                        "volume": v,
                    })

                results.append({
                    "symbol": symbol,
                    "signals": [
                        {
                            "action": s.action,
                            "price": _safe_float(s.price),
                            "strategy": s.strategy,
                            "strength": _safe_float(s.strength, 0.8),
                            "explanation": getattr(s, "explanation", "") or SignalExplainer.explain_signal(
                                symbol, s.strategy, s.action, _safe_float(s.price), getattr(s, "metadata", {}) or {}
                            ),
                        }
                        for s in signals
                    ],
                    "candles": candles,
                })

        return Response(results)


class ExecuteView(APIView):
    def post(self, request):
        symbol = request.data.get("symbol")
        side = request.data.get("side")
        qty = int(request.data.get("quantity", 0))
        price = float(request.data.get("price", 0))

        if not all([symbol, side, qty, price]):
            return Response({"error": "Missing fields: symbol, side, quantity, price"}, status=400)

        rm = get_risk_manager()
        approved, adj_qty, reason = rm.validate_signal(symbol, side, price)

        if not approved:
            return Response({"error": reason}, status=400)

        final_qty = min(qty, adj_qty)
        executor = OrderExecutor()
        order_id = executor.place_order(symbol, side, final_qty, price)

        if not order_id:
            return Response({"error": "Order failed"}, status=500)

        rm.register_order()
        if get_settings().mode == "live":
            return Response({
                "order_id": order_id,
                "status": "pending",
                "message": f"Live order {order_id} submitted to Angel One. Awaiting execution fill from broker order book.",
            })

        if side.upper() == "SELL":
            pnl = rm.close_position(symbol, price)
            trade_log.logger.info(f"Position closed: {symbol} {final_qty} @ Rs{price}; P&L Rs{pnl}")
            try:
                from alerts.telegram import send_position_closed_alert
                send_position_closed_alert(symbol, pnl, 0.0, reason="Manual/Signal Sell Order")
            except Exception:
                pass
            try:
                from alerts.whatsapp import send_whatsapp_position_closed_alert
                send_whatsapp_position_closed_alert(symbol, pnl, 0.0, reason="Manual/Signal Sell Order")
            except Exception:
                pass
            return Response({"order_id": order_id, "status": "executed", "realized_pnl": pnl})

        pos = rm.open_position(symbol, side, final_qty, price)
        trade_log.logger.info(f"Position opened: {pos.symbol} {pos.side} {pos.quantity} @ Rs{price}")
        try:
            from alerts.telegram import send_trade_executed_alert
            send_trade_executed_alert(pos.symbol, pos.side, pos.quantity, pos.entry_price, pos.stop_loss, pos.take_profit)
        except Exception:
            pass
        try:
            from alerts.whatsapp import send_whatsapp_trade_alert
            send_whatsapp_trade_alert(pos.symbol, pos.side, pos.quantity, pos.entry_price, pos.stop_loss, pos.take_profit)
        except Exception:
            pass

        return Response({
            "order_id": order_id,
            "status": "executed",
            "position": {
                "symbol": pos.symbol,
                "side": pos.side,
                "quantity": pos.quantity,
                "entry_price": pos.entry_price,
                "stop_loss": pos.stop_loss,
                "take_profit": pos.take_profit,
            },
        })


class BacktestView(APIView):
    def post(self, request):
        serializer = BacktestRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        data = serializer.validated_data
        fetcher = DataFetcher()
        ohlcv = fetcher.fetch_historical(data["symbol"], days=data["days"])

        if ohlcv.empty:
            return Response({"error": "No data available"}, status=404)

        bt = BacktestEngine(
            strategy_names=data["strategies"],
            capital=float(data["capital"]),
        )
        result = bt.run(data["symbol"], ohlcv)
        return Response(result)


class BacktestWatchlistView(APIView):
    def get(self, request):
        settings = get_settings()
        fetcher = DataFetcher()
        bt = BacktestEngine()
        results = bt.run_watchlist(fetcher)
        return Response(results)


class StrategiesView(APIView):
    def get(self, request):
        engine = StrategyEngine([])
        return Response({
            "available": engine.get_available(),
            "active": get_settings().active_strategies,
        })


class WatchlistScanView(APIView):
    def get(self, request):
        settings = get_settings()
        fetcher = DataFetcher()
        engine = StrategyEngine(settings.active_strategies)
        watchlist = settings.watchlist or ["RELIANCE", "SBIN", "ITC", "INFY", "TCS", "TATAMOTORS"]

        results = []
        for symbol in watchlist:
            try:
                df = fetcher.fetch_historical(symbol, days=60)
                if df.empty:
                    continue
                df = df.dropna(subset=["open", "high", "low", "close"])
                ltp = _safe_float(df["close"].iloc[-1])
                prev_close = _safe_float(df["close"].iloc[-2]) if len(df) > 1 else ltp
                change_pct = round(((ltp - prev_close) / (prev_close or 1)) * 100, 2)

                signals = engine.analyze(symbol, df)
                latest_signal = signals[-1] if signals else None
                sig_strength = _safe_float(getattr(latest_signal, "strength", 0.8), 0.8) if latest_signal else 0

                results.append({
                    "symbol": symbol,
                    "price": ltp,
                    "change_pct": change_pct,
                    "signal": latest_signal.action if latest_signal else "HOLD",
                    "strategy": latest_signal.strategy if latest_signal else "—",
                    "confidence": round(sig_strength * 100, 0) if latest_signal else 0,
                    "reason": getattr(latest_signal, "reason", "No breakout condition met"),
                    "date": str(getattr(latest_signal, "timestamp", df.iloc[-1].get("date", "Today"))).split(" ")[0],
                })
            except Exception as e:
                trade_log.logger.warning(f"Watchlist scan error for {symbol}: {e}")

        return Response(results)


def _update_env_file(updates: dict):
    from pathlib import Path
    from dotenv import load_dotenv
    env_file = Path(__file__).resolve().parent.parent.parent / ".env"
    lines = []
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            lines = f.readlines()

    keys_written = set()
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in line:
            k, _, _ = line.partition("=")
            k = k.strip()
            if k in updates:
                new_lines.append(f"{k}={updates[k]}\n")
                keys_written.add(k)
                continue
        new_lines.append(line)

    # Append any new keys
    for k, v in updates.items():
        if k not in keys_written:
            new_lines.append(f"{k}={v}\n")

    with open(env_file, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

    load_dotenv(env_file, override=True)


class SettingsView(APIView):
    def get(self, request):
        import yaml
        import os
        from pathlib import Path
        settings_file = Path(__file__).resolve().parent.parent.parent / "config" / "settings.yaml"
        try:
            with open(settings_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}

            # Overlay environment variables for secrets
            tg_enabled_env = os.getenv("TELEGRAM_ENABLED", "").lower()
            tg_enabled = tg_enabled_env in ("true", "1") if tg_enabled_env else data.get("telegram", {}).get("enabled", False)
            data["telegram"] = {
                "enabled": tg_enabled,
                "bot_token": os.getenv("TELEGRAM_BOT_TOKEN", ""),
                "chat_id": os.getenv("TELEGRAM_CHAT_ID", ""),
            }

            wa_enabled_env = os.getenv("WHATSAPP_ENABLED", "").lower()
            wa_enabled = wa_enabled_env in ("true", "1") if wa_enabled_env else data.get("whatsapp", {}).get("enabled", False)
            data["whatsapp"] = {
                "enabled": wa_enabled,
                "phone": os.getenv("WHATSAPP_PHONE", ""),
                "api_key": os.getenv("WHATSAPP_API_KEY", ""),
            }

            return Response(data)
        except Exception as e:
            return Response({"error": f"Failed to read settings: {str(e)}"}, status=500)

    def post(self, request):
        import yaml
        import copy
        from pathlib import Path
        settings_file = Path(__file__).resolve().parent.parent.parent / "config" / "settings.yaml"
        new_settings = request.data
        if not isinstance(new_settings, dict):
            return Response({"error": "Invalid settings payload"}, status=400)
        try:
            yaml_settings = copy.deepcopy(new_settings)
            env_updates = {}

            # Extract Telegram secrets -> .env
            if "telegram" in new_settings:
                tg = new_settings["telegram"]
                if "bot_token" in tg:
                    env_updates["TELEGRAM_BOT_TOKEN"] = str(tg["bot_token"]).strip()
                if "chat_id" in tg:
                    env_updates["TELEGRAM_CHAT_ID"] = str(tg["chat_id"]).strip()
                if "enabled" in tg:
                    env_updates["TELEGRAM_ENABLED"] = "true" if tg["enabled"] else "false"
                # Strip secrets from YAML save
                yaml_settings["telegram"] = {"enabled": bool(tg.get("enabled", False))}

            # Extract WhatsApp secrets -> .env
            if "whatsapp" in new_settings:
                wa = new_settings["whatsapp"]
                if "phone" in wa:
                    env_updates["WHATSAPP_PHONE"] = str(wa["phone"]).strip().replace("+", "").replace(" ", "").replace("-", "")
                if "api_key" in wa:
                    env_updates["WHATSAPP_API_KEY"] = str(wa["api_key"]).strip()
                if "enabled" in wa:
                    env_updates["WHATSAPP_ENABLED"] = "true" if wa["enabled"] else "false"
                # Strip secrets from YAML save
                yaml_settings["whatsapp"] = {"enabled": bool(wa.get("enabled", False))}

            # Persist secrets to .env
            if env_updates:
                _update_env_file(env_updates)

            # Persist non-sensitive configurations to settings.yaml
            with open(settings_file, "w", encoding="utf-8") as f:
                yaml.safe_dump(yaml_settings, f, default_flow_style=False, sort_keys=False)

            rm = get_risk_manager()
            risk_cfg = new_settings.get("risk", {})
            if "capital" in risk_cfg:
                rm.initial_capital = float(risk_cfg["capital"])
                rm.current_capital = float(risk_cfg["capital"])
            if "max_position_pct" in risk_cfg:
                rm.max_position_pct = float(risk_cfg["max_position_pct"])
            if "max_daily_loss_pct" in risk_cfg:
                rm.max_daily_loss_pct = float(risk_cfg["max_daily_loss_pct"])
            if "stop_loss_pct" in risk_cfg:
                rm.stop_loss_pct = float(risk_cfg["stop_loss_pct"])
            if "take_profit_pct" in risk_cfg:
                rm.take_profit_pct = float(risk_cfg["take_profit_pct"])
            if "max_open_positions" in risk_cfg:
                rm.max_open_positions = int(risk_cfg["max_open_positions"])

            return Response({"status": "success", "message": "Settings updated and secrets safely persisted to .env", "settings": new_settings})
        except Exception as e:
            return Response({"error": f"Failed to save settings: {str(e)}"}, status=500)


class TelegramTestView(APIView):
    def post(self, request):
        import json
        import urllib.request
        bot_token = request.data.get("bot_token", "").strip()
        chat_id = request.data.get("chat_id", "").strip()

        if not bot_token or not chat_id:
            return Response({"error": "Missing bot_token or chat_id"}, status=400)

        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": "⚡ <b>StockBot Test Alert</b>\n\n✅ Telegram alerts configured successfully! You will receive live trade signals and execution updates.",
            "parse_mode": "HTML",
        }
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                if res.get("ok"):
                    return Response({"status": "success", "message": "Test message sent to Telegram!"})
                return Response({"error": f"Telegram API error: {res}"}, status=400)
        except Exception as e:
            return Response({"error": f"Failed to reach Telegram API: {str(e)}"}, status=500)


class WhatsAppTestView(APIView):
    def post(self, request):
        import urllib.request
        import urllib.parse

        phone = str(request.data.get("phone", "")).strip().replace("+", "").replace(" ", "").replace("-", "")
        api_key = str(request.data.get("api_key", "")).strip()

        if not phone or not api_key:
            return Response({"error": "Missing phone number or API key"}, status=400)

        test_msg = (
            "⚡ *StockBot Test Alert*\n\n"
            "✅ *WhatsApp alerts configured successfully!*\n"
            "You will now receive automated trade signals, entry execution, and SL/TP notifications on WhatsApp."
        )
        encoded_text = urllib.parse.quote(test_msg)
        url = f"https://api.callmebot.com/whatsapp.php?phone={phone}&text={encoded_text}&apikey={api_key}"

        try:
            req = urllib.request.Request(url, headers={"User-Agent": "StockBot/2.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                res_body = resp.read().decode("utf-8")
                if "Message queued" in res_body or "Success" in res_body or resp.status == 200:
                    return Response({"status": "success", "message": "Test message sent to your WhatsApp!"})
                return Response({"error": f"CallMeBot error: {res_body}"}, status=400)
        except Exception as e:
            return Response({"error": f"Failed to reach WhatsApp API: {str(e)}"}, status=500)


class EmergencySquareOffView(APIView):
    def post(self, request):
        rm = get_risk_manager()
        fetcher = DataFetcher()
        prices = {sym: fetcher.fetch_live_price(sym) for sym in rm.positions}
        closed = rm.square_off_all(prices, reason="USER_EMERGENCY_KILL_SWITCH")
        return Response({
            "status": "success",
            "message": f"Successfully squared off {len(closed)} open positions",
            "closed_positions": closed,
        })


class AutoTraderStatusView(APIView):
    def get(self, request):
        from execution.auto_trader import auto_trader
        return Response(auto_trader.get_status())


class AutoTraderToggleView(APIView):
    def post(self, request):
        from execution.auto_trader import auto_trader
        action = request.data.get("action", "").lower()
        interval = request.data.get("interval", None)
        if interval:
            try:
                interval = int(interval)
            except (ValueError, TypeError):
                interval = None

        if action == "start":
            success, msg = auto_trader.start(interval_seconds=interval)
        elif action == "stop":
            success, msg = auto_trader.stop()
        else:
            if auto_trader.is_running:
                success, msg = auto_trader.stop()
            else:
                success, msg = auto_trader.start(interval_seconds=interval)

        return Response({
            "status": "success" if success else "error",
            "message": msg,
            "state": auto_trader.get_status(),
        })


class CalendarPnLView(APIView):
    def get(self, request):
        from core.models import TradeLog
        import collections

        trades = TradeLog.objects.filter(pnl_type="REALIZED").order_by("-created_at")
        daily_map = collections.defaultdict(lambda: {
            "pnl": 0.0,
            "wins": 0,
            "losses": 0,
            "total_trades": 0,
            "trades": []
        })

        for t in trades:
            date_str = t.created_at.strftime("%Y-%m-%d")
            pnl_val = float(t.pnl)
            daily_map[date_str]["pnl"] += pnl_val
            daily_map[date_str]["total_trades"] += 1
            if pnl_val >= 0:
                daily_map[date_str]["wins"] += 1
            else:
                daily_map[date_str]["losses"] += 1
            daily_map[date_str]["trades"].append({
                "id": str(t.id),
                "symbol": t.symbol,
                "side": t.side,
                "quantity": t.quantity,
                "entry_price": float(t.entry_price),
                "exit_price": float(t.exit_price or 0),
                "pnl": pnl_val,
                "pnl_pct": float(t.pnl_pct),
                "strategy": t.strategy,
                "time": t.created_at.strftime("%H:%M:%S")
            })

        result = [
            {
                "date": date_str,
                "pnl": round(data["pnl"], 2),
                "wins": data["wins"],
                "losses": data["losses"],
                "total_trades": data["total_trades"],
                "trades": data["trades"]
            }
            for date_str, data in sorted(daily_map.items(), reverse=True)
        ]

        return Response({"status": "success", "calendar": result})

