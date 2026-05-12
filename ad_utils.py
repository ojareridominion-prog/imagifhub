import logging
import os
from datetime import datetime, timedelta
import aiohttp
from config import supabase, bot, ADMIN_IDS   # <-- import ADMIN_IDS
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

async def send_banner_ad(chat_id: int, user_id: int):
    """Send one random banner ad to the user if not premium and cooldown allows (8h between ads, max 3 per day)."""
    # Skip ads for any admin ID
    if user_id in ADMIN_IDS:   # <-- now checks list
        return

    # 1. Get or create user record
    try:
        user_result = supabase.table("users").select("*").eq("telegram_id", user_id).execute()
        if not user_result.data:
            supabase.table("users").insert({
                "telegram_id": user_id,
                "is_premium": False,
                "ad_count_today": 0,
                "last_ad_time": None
            }).execute()
            user_data = {"is_premium": False, "ad_count_today": 0, "last_ad_time": None}
        else:
            user_data = user_result.data[0]
    except Exception as e:
        logging.error(f"Error fetching user for ad check: {e}")
        return

    # 2. Premium check
    is_premium = user_data.get("is_premium", False)
    if is_premium:
        return

    # 3. Cooldown & daily limit
    now = datetime.utcnow()
    today_date = now.date()
    ad_count_today = user_data.get("ad_count_today", 0)
    last_ad_time_str = user_data.get("last_ad_time")
    last_ad_time = None
    if last_ad_time_str:
        try:
            last_ad_time = datetime.fromisoformat(last_ad_time_str.replace('Z', '+00:00'))
            if last_ad_time.tzinfo:
                last_ad_time = last_ad_time.replace(tzinfo=None)
        except:
            pass

    if last_ad_time and last_ad_time.date() != today_date:
        ad_count_today = 0

    if ad_count_today >= 3:
        logging.info(f"User {user_id} reached daily ad limit (3)")
        return
    if last_ad_time and (now - last_ad_time) < timedelta(hours=8):
        logging.info(f"User {user_id} within 8h cooldown")
        return

    # 4. Fetch a random ad
    base_url = os.environ.get("RENDER_EXTERNAL_URL", "https://imagifhub.onrender.com")
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(f"{base_url}/api/random-ad") as resp:
                if resp.status == 200:
                    ad = await resp.json()
                else:
                    return
        except Exception as e:
            logging.error(f"Failed to fetch ad: {e}")
            return

    # 5. Convert relative image path to absolute URL
    image_url = ad.get("image", "")
    if image_url and not image_url.startswith(("http://", "https://")):
        # Assume relative to base_url (e.g., "ads/channel.png")
        image_url = f"{base_url}/{image_url.lstrip('/')}"
        logging.info(f"Resolved image URL: {image_url}")

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=ad.get("buttonLabel", "Learn More"), url=ad["action"])]
    ])
    caption = f"<b>{ad['title']}</b>\n{ad['subtitle']}"
    try:
        if image_url:
            await bot.send_photo(chat_id, photo=image_url,
                                 caption=f"✨ Sponsored ✨\n\n{caption}",
                                 parse_mode="HTML", reply_markup=keyboard)
        else:
            # Fallback to text-only banner
            await bot.send_message(chat_id, text=f"✨ Sponsored ✨\n\n{caption}",
                                   parse_mode="HTML", reply_markup=keyboard)
    except Exception as e:
        logging.error(f"Failed to send ad: {e}")
        return

    # 6. Update user tracking
    new_count = ad_count_today + 1
    supabase.table("users").update({
        "ad_count_today": new_count,
        "last_ad_time": now.isoformat()
    }).eq("telegram_id", user_id).execute()
    logging.info(f"Ad sent to user {user_id}, count today: {new_count}")
    
