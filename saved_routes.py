# saved_routes.py
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase
import logging

router = APIRouter()

@router.get("/api/saved-images")
async def get_saved_images(telegram_id: int):
    """Get saved images for a user."""
    try:
        user_res = supabase.table("users").select("saved_images").eq("telegram_id", telegram_id).execute()
        if not user_res.data or not user_res.data[0].get("saved_images"):
            return []
        saved_ids = user_res.data[0]["saved_images"]
        if not saved_ids:
            return []
        # saved_ids are UUID strings, use .in_ with string list
        images_res = supabase.table("media_content").select("*").in_("id", saved_ids).execute()
        return images_res.data or []
    except Exception as e:
        logging.error(f"Error fetching saved images: {e}")
        return []

@router.post("/api/toggle-save-image")
async def toggle_save_image(request: Request):
    try:
        data = await request.json()
        telegram_id = data.get("telegram_id")
        image_id = data.get("image_id")
        if not telegram_id or not image_id:
            return {"status": "error", "message": "Missing telegram_id or image_id"}
        
        # Keep image_id as string (UUID)
        image_id = str(image_id)  # ensure it's a string
        
        user_res = supabase.table("users").select("saved_images").eq("telegram_id", telegram_id).execute()
        current_saved = []
        if user_res.data and user_res.data[0].get("saved_images"):
            current_saved = user_res.data[0]["saved_images"]
        
        # Toggle using string comparison
        if image_id in current_saved:
            current_saved.remove(image_id)
            is_saved = False
        else:
            current_saved.append(image_id)
            is_saved = True
        
        supabase.table("users").update({"saved_images": current_saved}).eq("telegram_id", telegram_id).execute()
        return {"status": "success", "is_saved": is_saved, "saved_images": current_saved}
    except Exception as e:
        logging.error(f"Error toggling save image: {e}")
        return {"status": "error", "message": str(e)}
        
