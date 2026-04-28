from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timedelta
import logging
from config import supabase, bot
from gifts_data import GIFTS
from utils import get_user_id_from_init_data
from aiogram.types import LabeledPrice

router = APIRouter()

def get_seasonal_category():
    """Return current season category (halloween, christmas, newyear, summer, spring) or None"""
    now = datetime.utcnow()
    month, day = now.month, now.day
    # Halloween: Oct 1-31
    if month == 10:
        return "halloween"
    # Christmas: Dec 1-30
    if month == 12 and day <= 30:
        return "christmas"
    # New Year: Dec 31 - Jan 7
    if (month == 12 and day >= 31) or (month == 1 and day <= 7):
        return "newyear"
    # Summer: Jun 1 - Aug 31
    if 6 <= month <= 8:
        return "summer"
    # Spring: Mar 1 - May 31 (Easter inclusive)
    if 3 <= month <= 5:
        return "spring"
    return None

@router.get("/api/gifts")
async def get_gifts():
    """Return all gifts (client will filter by season)"""
    return GIFTS

@router.post("/api/create-gift-invoice")
async def create_gift_invoice(request: Request):
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")
    
    body = await request.json()
    gift_id = body.get("giftId")
    if not gift_id:
        raise HTTPException(status_code=400, detail="Missing giftId")
    
    # Find gift
    gift = next((g for g in GIFTS if g["id"] == gift_id), None)
    if not gift:
        raise HTTPException(status_code=400, detail="Invalid gift")
    
    try:
        invoice_link = await bot.create_invoice_link(
            title=f"Gift: {gift['emoji']} {gift['name']}",
            description=f"Send {gift['emoji']} {gift['name']} as a gift",
            payload=f"gift_{gift_id}_{user_id}",
            provider_token="",
            currency="XTR",
            prices=[LabeledPrice(label=gift['name'], amount=gift['price'])]
        )
        return {"invoice_link": invoice_link, "gift": gift}
    except Exception as e:
        logging.error(f"Gift invoice error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create invoice")

@router.get("/api/user-recent-gift")
async def user_recent_gift(request: Request):
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")
    
    try:
        result = supabase.table("gift_purchases") \
            .select("*") \
            .eq("user_id", user_id) \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()
        if result.data and result.data[0]:
            gift = result.data[0]
            created_at = datetime.fromisoformat(gift["created_at"].replace('Z', '+00:00'))
            now = datetime.utcnow().replace(tzinfo=None)
            if created_at.tzinfo:
                created_at = created_at.replace(tzinfo=None)
            age = now - created_at
            if age < timedelta(hours=24):
                expires_in = timedelta(hours=24) - age
                gift["expires_in_seconds"] = int(expires_in.total_seconds())
                return gift
        return None
    except Exception as e:
        logging.error(f"Error fetching recent gift: {e}")
        return None
      
