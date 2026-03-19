from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
from datetime import datetime
import json
import urllib.parse
import logging
import httpx
from config import supabase, bot, BOT_TOKEN
from utils import get_user_id_from_init_data

router = APIRouter()

async def check_premium_logic(user_id: int):
    """Reusable premium check logic"""
    try:
        print(f"🔍 Checking premium for user: {user_id}")
        result = supabase.table("users") \
            .select("*") \
            .eq("telegram_id", user_id) \
            .execute()
        
        print(f"📊 Query result: {result.data}")
        
        if not result.data:
            print(f"❌ User {user_id} not found")
            return {"is_premium": False, "expires_at": None, "days_left": None}
        
        data = result.data[0]
        is_premium = data.get("is_premium")
        expires_at_str = data.get("premium_expires_at")
        
        print(f"📋 Data: is_premium={is_premium} (type: {type(is_premium)}), expires_at={expires_at_str}")
        
        is_premium_bool = False
        if isinstance(is_premium, bool):
            is_premium_bool = is_premium
        elif isinstance(is_premium, str):
            is_premium_bool = is_premium.lower() == 'true'
        elif isinstance(is_premium, int):
            is_premium_bool = bool(is_premium)
        
        if is_premium_bool and expires_at_str:
            try:
                expires_at_str_clean = expires_at_str
                if expires_at_str.endswith('Z'):
                    expires_at_str_clean = expires_at_str.replace('Z', '+00:00')
                
                expires_at = datetime.fromisoformat(expires_at_str_clean)
                now = datetime.utcnow().replace(tzinfo=None)
                
                if expires_at.tzinfo is not None:
                    expires_at = expires_at.replace(tzinfo=None)
                
                print(f"⏰ Now: {now}, Expires: {expires_at}")
                
                if expires_at > now:
                    days_left = (expires_at - now).days
                    print(f"✅ Premium ACTIVE! Days left: {days_left}")
                    return {
                        "is_premium": True,
                        "expires_at": expires_at.isoformat(),
                        "days_left": days_left
                    }
                else:
                    print(f"❌ Premium EXPIRED")
            except Exception as e:
                print(f"⚠️ Date parsing error: {e}")
                import traceback
                traceback.print_exc()
        
        print(f"❌ No active premium found. is_premium_bool={is_premium_bool}")
        return {"is_premium": False, "expires_at": None, "days_left": None}
        
    except Exception as e:
        print(f"🔥 Error in check_premium: {e}")
        import traceback
        traceback.print_exc()
        return {"is_premium": False, "expires_at": None, "days_left": None}

@router.get("/api/check-premium")
async def check_premium(user_id: int):
    """Simplified premium check - only checks expiry date"""
    return await check_premium_logic(user_id)

@router.get("/api/user-data")
async def get_user_data(request: Request):
    """Get user data for the current Telegram user"""
    try:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        
        if not init_data:
            return {"user": None, "premium": False}
        
        user_id = get_user_id_from_init_data(init_data)
        
        if not user_id:
            return {"user": None, "premium": False}
        
        try:
            parsed = urllib.parse.parse_qs(init_data)
            user_json = json.loads(parsed['user'][0])
            user_info = {
                "id": user_json.get('id'),
                "username": user_json.get('username'),
                "first_name": user_json.get('first_name'),
                "last_name": user_json.get('last_name')
            }
        except:
            user_info = {"id": user_id}
        
        premium_result = await check_premium_logic(user_id)
        
        return {
            "user": user_info,
            "premium": premium_result["is_premium"],
            "expires_at": premium_result.get("expires_at"),
            "days_left": premium_result.get("days_left")
        }
        
    except Exception as e:
        logging.error(f"Error getting user data: {e}")
        return {"user": None, "premium": False}

@router.get("/api/debug-premium/{user_id}")
async def debug_premium(user_id: int):
    """Debug endpoint to see raw database data"""
    try:
        user_result = supabase.table("users").select("*").eq("telegram_id", user_id).execute()
        
        if not user_result.data:
            return {"error": "User not found", "user_id": user_id}
        
        user_data = user_result.data[0]
        is_premium = user_data.get("is_premium")
        expires_at_str = user_data.get("premium_expires_at")
        
        is_premium_bool = False
        if isinstance(is_premium, bool):
            is_premium_bool = is_premium
        elif isinstance(is_premium, str):
            is_premium_bool = is_premium.lower() == 'true'
        elif isinstance(is_premium, int):
            is_premium_bool = bool(is_premium)
        
        calculated_status = False
        expires_at = None
        
        if is_premium_bool and expires_at_str:
            try:
                expires_at_str_clean = expires_at_str
                if expires_at_str.endswith('Z'):
                    expires_at_str_clean = expires_at_str.replace('Z', '+00:00')
                expires_at = datetime.fromisoformat(expires_at_str_clean)
                now = datetime.utcnow().replace(tzinfo=None)
                
                if expires_at.tzinfo is not None:
                    expires_at = expires_at.replace(tzinfo=None)
                
                calculated_status = expires_at > now
            except Exception as e:
                print(f"Date parsing error in debug: {e}")
        
        return {
            "database_record": user_data,
            "current_time_utc": datetime.utcnow().isoformat(),
            "is_premium_raw": user_data.get("is_premium"),
            "is_premium_type": str(type(user_data.get("is_premium"))),
            "is_premium_bool": is_premium_bool,
            "expires_at_field": user_data.get("premium_expires_at"),
            "calculated_premium": calculated_status,
            "premium_active": calculated_status,
            "expires_at_naive": expires_at.isoformat() if expires_at else None,
            "current_time_naive": datetime.utcnow().replace(tzinfo=None).isoformat()
        }
    except Exception as e:
        return {"error": str(e)}

@router.get("/api/test-premium/{user_id}")
async def test_premium(user_id: int):
    """Direct test endpoint that shows everything"""
    try:
        user_result = supabase.table("users").select("*").eq("telegram_id", user_id).execute()
        
        response = {
            "user_id": user_id,
            "current_time_utc": datetime.utcnow().isoformat(),
            "database_record": user_result.data[0] if user_result.data else None,
            "raw_sql_test": None
        }
        
        if user_result.data:
            record = user_result.data[0]
            response["raw_sql_test"] = {
                "exists": True,
                "telegram_id": record.get("telegram_id"),
                "is_premium_raw": record.get("is_premium"),
                "is_premium_type": type(record.get("is_premium")).__name__,
                "expires_at_raw": record.get("premium_expires_at"),
                "calculated_status": record.get("is_premium") == True and 
                    datetime.fromisoformat(record.get("premium_expires_at").replace('Z', '+00:00')) > datetime.utcnow()
            }
        
        return response
        
    except Exception as e:
        return {"error": str(e), "user_id": user_id}

# ==================== NEW ENDPOINT: FETCH USER PROFILE PHOTO ====================

@router.get("/api/user-photo")
async def get_user_photo(request: Request):
    """
    Returns the user's Telegram profile photo as an image (JPEG).
    Requires X-Telegram-Init-Data header.
    """
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    try:
        # Get profile photos from Telegram
        photos = await bot.get_user_profile_photos(user_id, limit=1)
        if not photos or not photos.photos:
            raise HTTPException(status_code=404, detail="No profile photo")

        # Largest photo is the last in the list of sizes
        file_id = photos.photos[0][-1].file_id
        file = await bot.get_file(file_id)
        file_path = file.file_path

        # Download the image from Telegram servers
        url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"
        async with httpx.AsyncClient() as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                raise HTTPException(status_code=500, detail="Failed to fetch photo")
            return Response(content=resp.content, media_type="image/jpeg")

    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error fetching user photo: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
        
