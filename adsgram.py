from fastapi import APIRouter, Request, HTTPException
import logging
from datetime import datetime
from config import supabase

router = APIRouter()

@router.get("/adsgram-reward")
async def adsgram_reward(user_id: int):
    """
    Called by AdsGram after a user watches an ad.
    Logs the event and can optionally grant rewards.
    """
    try:
        logging.info(f"📢 AdsGram reward received for user {user_id}")
        
        # Optional: store ad view for analytics
        # supabase.table("ad_views").insert({
        #     "telegram_id": user_id,
        #     "watched_at": datetime.utcnow().isoformat()
        # }).execute()
        
        # Optional: give a small reward (e.g., 1 coin)
        # supabase.table("users").update({"coins": supabase.raw("coins + 1")}).eq("telegram_id", user_id).execute()
        
        return {"status": "ok"}
    except Exception as e:
        logging.error(f"Error in adsgram reward: {e}")
        raise HTTPException(status_code=500, detail=str(e))
      
