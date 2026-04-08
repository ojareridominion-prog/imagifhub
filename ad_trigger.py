from fastapi import APIRouter, Request, HTTPException
from ad_utils import send_banner_ad
from utils import get_user_id_from_init_data

router = APIRouter()

@router.post("/api/trigger-ad")
async def trigger_ad(request: Request):
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")
    await send_banner_ad(chat_id=user_id, user_id=user_id)
    return {"status": "ok"}
  
