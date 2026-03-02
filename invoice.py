from fastapi import APIRouter, Request, HTTPException
from aiogram.types import LabeledPrice
from config import bot
from utils import get_user_id_from_init_data
import logging

router = APIRouter()

@router.post("/api/create-invoice")
async def create_invoice(request: Request):
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")
    try:
        invoice_link = await bot.create_invoice_link(
            title="IMAGIFHUB Premium",
            description="30 days of ad‑free experience",
            payload=f"premium_{user_id}",
            provider_token="",
            currency="XTR",
            prices=[LabeledPrice(label="Premium Access", amount=99)]
        )
        return {"invoice_link": invoice_link}
    except Exception as e:
        logging.error(f"Invoice creation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Invoice creation failed: {str(e)}")
