import os
import logging
import random
import asyncio
import requests
import json
import urllib.parse
from datetime import datetime, timedelta
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, Update, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, PreCheckoutQuery, ContentType
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client
from aiogram.types import LabeledPrice

# ==================== CONFIG ====================
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_ID", 0))
IMGBB_API_KEY = os.environ.get("IMGBB_API_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")  # Separate from BOT_TOKEN

# Initialize Clients
app = FastAPI()
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

CATEGORIES = [
    "Nature", "Places", "Aesthetic", "Cars",
    "Luxury", "Art", "Animals", "Historical",
    "Anime", "Featured"
]

# ==================== HELPER FUNCTIONS ====================

def get_user_id_from_init_data(init_data: str):
    """Extract user ID from Telegram WebApp initData"""
    try:
        parsed = urllib.parse.parse_qs(init_data)
        if 'user' in parsed:
            user_data = json.loads(parsed['user'][0])
            return user_data.get('id')
    except Exception as e:
        logging.error(f"Error parsing initData: {e}")
    return None

def ensure_utc_z(dt_str: str) -> str:
    """Ensure datetime string ends with Z (UTC indicator)."""
    if not dt_str.endswith('Z'):
        dt_str += 'Z'
    return dt_str

# ==================== WEBHOOK HELPERS ====================

@app.post("/api/telegram-webhook")
async def handle_webhook(request: Request):
    """Handles incoming messages from Telegram"""
    try:
        data = await request.json()
        update = Update(**data)
        await dp.feed_update(bot, update)
        return {"ok": True}
    except Exception as e:
        logging.error(f"Webhook Error: {e}")
        return {"ok": False, "error": str(e)}

@app.get("/api/set-webhook")
async def set_webhook(request: Request):
    host = request.headers.get("host")
    url = f"https://{host}/api/telegram-webhook"
    await bot.set_webhook(url=url, drop_pending_updates=True)
    return {"status": "Webhook updated", "new_url": url}

# ==================== PAYMENT HANDLERS (STARS) ====================

@dp.pre_checkout_query()
async def on_pre_checkout_query(pre_checkout_query: PreCheckoutQuery):
    await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)

@dp.message(F.content_type == ContentType.SUCCESSFUL_PAYMENT)
async def on_successful_payment(message: Message):
    try:
        payment = message.successful_payment
        telegram_id = message.from_user.id

        # Calculate expiry (30 days from now) with UTC Z
        expires_at = datetime.utcnow() + timedelta(days=30)
        expires_at_str = expires_at.isoformat() + "Z"

        # Record the payment
        supabase.table("payments").insert({
            "telegram_id": telegram_id,
            "provider": "telegram_stars",
            "amount": payment.total_amount,
            "currency": payment.currency,
            "payload": payment.invoice_payload,
            "transaction_id": payment.telegram_payment_charge_id,
            "status": "completed"
        }).execute()

        # Update User Premium Status
        supabase.table("users").upsert({
            "telegram_id": telegram_id,
            "is_premium": True,
            "premium_expires_at": expires_at_str,
            "updated_at": datetime.utcnow().isoformat() + "Z"
        }).execute()

        # Send congratulatory message with instructions
        await message.answer(
            "🎉 Payment successful! You are now an IMAGIFHUB Premium member!\n\n"
            "✅ Your premium access is active for 30 days.\n"
            "✅ Ads have been removed from your experience.\n\n"
            "To refresh your premium status in the app:\n"
            "1. Close and reopen the IMAGIFHUB Mini App\n"
            "2. Or tap 'Check Premium Status' button\n\n"
            "Use /premium anytime to check your status."
        )

        # Also send a button to refresh the mini app
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔄 Refresh Mini App", web_app={"url": "https://ojareridominion-prog.github.io/imagifhub/"})],
            [InlineKeyboardButton(text="🚀 Open IMAGIFHUB", web_app={"url": "https://ojareridominion-prog.github.io/imagifhub/"})]
        ])

        await message.answer(
            "Click below to open the refreshed app with premium activated:",
            reply_markup=keyboard
        )

    except Exception as e:
        logging.error(f"Payment DB Error: {e}")
        await message.answer("Payment received, but there was an error activating premium. Please contact support.")

# ==================== NEW INVOICE ENDPOINT FOR IN‑APP PURCHASE ====================

@app.post("/api/create-invoice")
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

# ==================== PREMIUM VERIFICATION ENDPOINTS ====================

@app.get("/api/check-premium")
async def check_premium(user_id: int):
    """Simplified premium check - only checks expiry date, returns days_left"""
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

        # Handle boolean value properly (might be string 'true' or boolean True)
        is_premium_bool = False
        if isinstance(is_premium, bool):
            is_premium_bool = is_premium
        elif isinstance(is_premium, str):
            is_premium_bool = is_premium.lower() == 'true'
        elif isinstance(is_premium, int):
            is_premium_bool = bool(is_premium)

        # Check if premium is active
        if is_premium_bool and expires_at_str:
            try:
                # Ensure expires_at_str has Z for UTC
                expires_at_str = ensure_utc_z(expires_at_str)
                expires_at = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                now = datetime.utcnow().replace(tzinfo=None)  # Make naive for comparison

                # If expires_at has timezone info, make it naive too
                if expires_at.tzinfo is not None:
                    expires_at = expires_at.replace(tzinfo=None)

                print(f"⏰ Now: {now}, Expires: {expires_at}")

                if expires_at > now:
                    days_left = (expires_at - now).days
                    print(f"✅ Premium ACTIVE! Days left: {days_left}")
                    return {
                        "is_premium": True,
                        "expires_at": expires_at_str,
                        "days_left": days_left
                    }
                else:
                    print(f"❌ Premium EXPIRED")
            except Exception as e:
                print(f"⚠️ Date parsing error: {e}")
                print(f"⚠️ Raw expires_at string: {expires_at_str}")
                import traceback
                traceback.print_exc()

        print(f"❌ No active premium found. is_premium_bool={is_premium_bool}")
        return {"is_premium": False, "expires_at": None, "days_left": None}

    except Exception as e:
        print(f"🔥 Error in check_premium: {e}")
        import traceback
        traceback.print_exc()
        return {"is_premium": False, "expires_at": None, "days_left": None}

@app.get("/api/user-data")
async def get_user_data(request: Request):
    """Get user data for the current Telegram user"""
    try:
        # Get user from Telegram WebApp initData
        init_data = request.headers.get("X-Telegram-Init-Data", "")

        if not init_data:
            return {"user": None, "premium": False}

        user_id = get_user_id_from_init_data(init_data)

        if not user_id:
            return {"user": None, "premium": False}

        # Get user info from initData
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

        # Check premium status
        premium_result = await check_premium(user_id)

        return {
            "user": user_info,
            "premium": premium_result["is_premium"],
            "expires_at": premium_result.get("expires_at"),
            "days_left": premium_result.get("days_left")
        }

    except Exception as e:
        logging.error(f"Error getting user data: {e}")
        return {"user": None, "premium": False}

# ==================== FRONTEND API ====================

@app.get("/media")
async def get_media(category: str = "all", search: str = ""):
    query = supabase.table('media_content').select('*')
    if category.lower() not in ["all", "discover"]:
        query = query.eq('category', category.title())
    if search:
        query = query.ilike('Keyword', f'%{search}%')
    res = query.execute()
    data = res.data
    random.shuffle(data)
    return data[:50]

# ==================== ADMIN ENDPOINTS (unchanged) ====================

@app.get("/api/admin/stats")
async def admin_stats(request: Request):
    """Admin statistics endpoint"""
    # Simple auth check
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")

    token = auth.replace("Bearer ", "").strip()
    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        # Get total users
        users_res = supabase.table("users").select("count", count="exact").execute()
        total_users = users_res.count or 0

        # Get premium users
        premium_res = supabase.table("users").select("count", count="exact").eq("is_premium", True).execute()
        premium_users = premium_res.count or 0

        # Get total payments
        payments_res = supabase.table("payments").select("amount", "currency").eq("status", "completed").execute()
        total_revenue = sum(p.get("amount", 0) for p in payments_res.data) if payments_res.data else 0

        # Recent payments
        recent_payments = supabase.table("payments").select("*").order("created_at", desc=True).limit(10).execute()

        return {
            "total_users": total_users,
            "premium_users": premium_users,
            "premium_percentage": (premium_users / total_users * 100) if total_users > 0 else 0,
            "total_revenue": total_revenue,
            "recent_payments": recent_payments.data if recent_payments.data else []
        }

    except Exception as e:
        logging.error(f"Admin stats error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ==================== BOT LOGIC (unchanged, but ensure expires_at gets Z) ====================

@dp.message(F.text == "/start")
async def cmd_start(message: Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Let's Go!", web_app={"url": "https://ojareridominion-prog.github.io/imagifhub/"})],
        [InlineKeyboardButton(text="📢 Official Channel", url="https://t.me/imagifhub")]
    ])
    await message.answer(
        "IMAGIFHUB isn't just an app—it's your personal portal to a world of endless, breathtaking beauty.\n\n"
        "Don't wait, click let's go 🚀🚀 to continue",
        reply_markup=keyboard
    )

@dp.message(F.text == "/premium")
async def cmd_premium(message: Message):
    """Check premium status or purchase premium - RELIES ONLY ON TELEGRAM ID"""
    telegram_id = message.from_user.id
    logging.info(f"Checking premium for user ID: {telegram_id}")

    try:
        # Simple query - only check telegram_id, is_premium, and premium_expires_at
        user_result = supabase.table("users") \
            .select("is_premium, premium_expires_at") \
            .eq("telegram_id", telegram_id) \
            .execute()

        # Debug logging
        logging.info(f"Query result: {user_result.data}")

        if not user_result.data or len(user_result.data) == 0:
            # User not in database - offer premium
            logging.info(f"User {telegram_id} not found in database")
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="⭐ Get Premium", callback_data="get_premium")],
                [InlineKeyboardButton(text="🚀 Open IMAGIFHUB", web_app={"url": "https://ojareridominion-prog.github.io/imagifhub/"})]
            ])
            await message.answer(
                "✨ <b>IMAGIFHUB Premium</b>\n\n"
                "🔓 You are currently on the free plan.\n\n"
                "✨ <b>Upgrade to Premium for:</b>\n"
                "• 🚫 No ads\n"
                "• 😁 Support the project\n\n"
                "💫 <b>Price:</b> 99 Stars (30 days)\n\n"
                "Click 'Get Premium' to upgrade!",
                parse_mode="HTML",
                reply_markup=keyboard
            )
            return

        user_data = user_result.data[0]
        is_premium = user_data.get("is_premium", False)
        premium_expires_at = user_data.get("premium_expires_at")

        logging.info(f"User {telegram_id} - is_premium: {is_premium}, expires_at: {premium_expires_at}")

        # Handle boolean value properly
        is_premium_bool = False
        if isinstance(is_premium, bool):
            is_premium_bool = is_premium
        elif isinstance(is_premium, str):
            is_premium_bool = is_premium.lower() == 'true'
        elif isinstance(is_premium, int):
            is_premium_bool = bool(is_premium)

        if is_premium_bool and premium_expires_at:
            try:
                # Parse date - ensure UTC Z
                expires_at_str = ensure_utc_z(premium_expires_at)
                expires_at = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                now = datetime.utcnow().replace(tzinfo=None)

                # Make expires_at naive for comparison
                if expires_at.tzinfo is not None:
                    expires_at = expires_at.replace(tzinfo=None)

                if expires_at > now:
                    days_left = (expires_at - now).days
                    await message.answer(
                        f"✨ <b>Premium Status</b>\n\n"
                        f"✅ You are a <b>Premium Member</b>!\n"
                        f"⏳ Days remaining: <b>{days_left}</b> day(s)\n"
                        f"📅 Expires on: {expires_at.strftime('%Y-%m-%d')}\n\n"
                        f"Enjoy your ad-free experience! 🎉",
                        parse_mode="HTML"
                    )
                    return
            except Exception as e:
                logging.error(f"Date parsing error for user {telegram_id}: {e}")
                # Continue to show free plan if date is invalid

        # If we get here, user is not premium
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⭐ Get Premium", callback_data="get_premium")],
            [InlineKeyboardButton(text="🚀 Open IMAGIFHUB", web_app={"url": "https://ojareridominion-prog.github.io/imagifhub/"})]
        ])
        await message.answer(
            "✨ <b>IMAGIFHUB Premium</b>\n\n"
            "🔓 You are currently on the free plan.\n\n"
            "✨ <b>Upgrade to Premium for:</b>\n"
            "• 🚫 No ads\n"
            "• 😁 Support the project\n\n"
            "💫 <b>Price:</b> 99 Stars (30 days)\n\n"
            "Click 'Get Premium' to upgrade!",
            parse_mode="HTML",
            reply_markup=keyboard
        )

    except Exception as e:
        logging.error(f"Premium check error for user {telegram_id}: {e}", exc_info=True)
        await message.answer(
            "❌ There was an error checking your premium status.\n\n"
            "Please try again in a few moments."
        )

@dp.callback_query(F.data == "get_premium")
async def get_premium_callback(call: CallbackQuery):
    """Create invoice for premium purchase"""
    await call.answer()

    invoice_link = await bot.create_invoice_link(
        title="IMAGIFHUB Premium",
        description="30 days of ad-free experience",
        payload=f"premium_{call.from_user.id}",
        provider_token="",
        currency="XTR",
        prices=[LabeledPrice(label="Premium Access", amount=99)]
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💳 Pay Now", url=invoice_link)],
        [InlineKeyboardButton(text="🔙 Back", callback_data="back_to_premium")]
    ])

    await call.message.edit_text(
        "✨ <b>Upgrade to IMAGIFHUB Premium</b>\n\n"
        "💫 <b>Price:</b> 99 Stars (30 days)\n\n"
        "<b>Benefits:</b>\n"
        "• 🚫 No ads\n"
        "• 😁 Support the project\n\n"
        "Click 'Pay Now' to complete your purchase.",
        parse_mode="HTML",
        reply_markup=keyboard
    )

@dp.callback_query(F.data == "back_to_premium")
async def back_to_premium_callback(call: CallbackQuery):
    """Go back to premium status screen"""
    await call.answer()
    await cmd_premium(call.message)

@dp.callback_query(F.data == "renew_premium")
async def renew_premium_callback(call: CallbackQuery):
    """Renew premium subscription"""
    await get_premium_callback(call)

# Handle deep linking for /start premium
# Handle deep linking for /start premium
@dp.message(F.text.startswith("/start premium"))
async def start_premium(message: Message):
    """Handle deep link from mini app"""
    # Extract user ID from the command if present
    parts = message.text.split()
    if len(parts) > 2:
        # Format: /start premium_123456
        await cmd_premium(message)
    else:
        await cmd_premium(message)

@dp.message(F.from_user.id == ADMIN_ID, F.text == "/admin")
async def admin_cmd(message: Message, state: FSMContext):
    await state.clear()
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload New Media", callback_data="up")]
    ])
    await message.answer("<b>Admin Control Panel</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data == "up")
async def up_step1(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Please send the photo you want to add to the gallery.")
    await state.set_state(AdminUpload.waiting_media)

@dp.message(AdminUpload.waiting_media, F.photo)
async def up_step2(message: Message, state: FSMContext):
    file_id = message.photo[-1].file_id
    file = await bot.get_file(file_id)
    media_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file.file_path}"

    resp = requests.post(
        "https://api.imgbb.com/1/upload",
        params={'key': IMGBB_API_KEY, 'image': media_url}
    )

    if resp.status_code == 200:
        final_url = resp.json()['data']['url']
        await state.update_data(url=final_url)
        btns = []
        for i in range(0, len(CATEGORIES), 2):
            row = [InlineKeyboardButton(text=c, callback_data=f"set_{c}") for c in CATEGORIES[i:i+2]]
            btns.append(row)
        await message.answer("Select the Category:", reply_markup=InlineKeyboardMarkup(inline_keyboard=btns))
        await state.set_state(AdminUpload.waiting_category)
    else:
        await message.answer("❌ Error uploading to ImgBB.")

@dp.callback_query(F.data.startswith("set_"))
async def up_step3(call: CallbackQuery, state: FSMContext):
    category = call.data.split("_")[1]
    await state.update_data(category=category)
    await call.message.edit_text(f"Category set to: {category}\nNow type keywords:")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def up_final(message: Message, state: FSMContext):
    user_data = await state.get_data()
    supabase.table('media_content').insert({
        "url": user_data['url'],
        "category": user_data['category'],
        "Keyword": message.text
    }).execute()
    await message.answer(f"✅ Successfully added to {user_data['category']}!")
    await state.clear()
