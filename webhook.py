from fastapi import APIRouter, Request
import logging
from aiogram.types import Update
from config import bot, dp

router = APIRouter()

@router.post("/api/telegram-webhook")
async def handle_webhook(request: Request):
    """Handles incoming messages from Telegram"""
    try:
        data = await request.json()
        # Log update type to debug pre_checkout_query arrival
        update_type = "unknown"
        if "pre_checkout_query" in data:
            update_type = "pre_checkout_query"
        elif "message" in data:
            update_type = "message"
        elif "callback_query" in data:
            update_type = "callback_query"
        logging.info(f"Webhook received: update_id={data.get('update_id')}, type={update_type}")

        update = Update(**data)
        await dp.feed_update(bot, update)
        return {"ok": True}
    except Exception as e:
        logging.error(f"Webhook Error: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}

@router.get("/api/set-webhook")
async def set_webhook(request: Request):
    try:
        host = request.headers.get("host")
        url = f"https://{host}/api/telegram-webhook"
        await bot.set_webhook(url=url, drop_pending_updates=True)
        logging.info(f"Webhook manually set to {url}")
        return {"status": "Webhook updated", "new_url": url}
    except Exception as e:
        logging.error(f"Failed to set webhook: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}
        
