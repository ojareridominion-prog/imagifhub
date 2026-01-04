import os
import logging
import random
import asyncio
import requests
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
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

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
    "Luxury", "Anime", "Animals", "Ancient", 
    "Marine", "Art", "Fictional", "Funny", "Featured"
]

# ==================== SIMPLIFIED API ENDPOINTS ====================

@app.get("/api/check-premium")
async def check_premium(user_id: int):
    """Check premium status - SIMPLIFIED VERSION"""
    print(f"🔍 API: Checking premium for user {user_id}")
    
    try:
        # Direct query to Supabase
        result = supabase.table("users") \
            .select("telegram_id, is_premium, premium_expires_at") \
            .eq("telegram_id", user_id) \
            .execute()
        
        print(f"📊 API: Query result: {result.data}")
        
        if not result.data:
            print(f"❌ API: User {user_id} not found in database")
            return {"is_premium": False, "expires_at": None, "days_left": None}
        
        user = result.data[0]
        print(f"📋 API: User data: {user}")
        
        is_premium = user.get("is_premium", False)
        expires_at_str = user.get("premium_expires_at")
        
        # If is_premium is True and we have an expiry date
        if is_premium and expires_at_str:
            try:
                # Parse the date
                if expires_at_str.endswith('Z'):
                    expires_at = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                else:
                    expires_at = datetime.fromisoformat(expires_at_str)
                
                now = datetime.utcnow()
                
                print(f"⏰ API: Now: {now}, Expires: {expires_at}")
                
                if expires_at > now:
                    days_left = (expires_at - now).days
                    print(f"✅ API: Premium ACTIVE! Days left: {days_left}")
                    return {
                        "is_premium": True,
                        "expires_at": expires_at.isoformat(),
                        "days_left": days_left
                    }
            except Exception as e:
                print(f"⚠️ API: Date parsing error: {e}")
        
        print(f"❌ API: No active premium for user {user_id}")
        return {"is_premium": False, "expires_at": None, "days_left": None}
        
    except Exception as e:
        print(f"🔥 API: Error: {e}")
        return {"is_premium": False, "expires_at": None, "days_left": None}

@app.get("/api/user-data")
async def get_user_data(user_id: int):
    """Get user data for frontend"""
    try:
        # Check premium status
        premium_result = await check_premium(user_id)
        
        return {
            "user": {"id": user_id},
            "premium": premium_result["is_premium"],
            "expires_at": premium_result.get("expires_at")
        }
        
    except Exception as e:
        print(f"Error in user-data: {e}")
        return {"user": None, "premium": False}

@app.get("/media")
async def get_media(category: str = "all", search: str = ""):
    """Get media content"""
    query = supabase.table('media_content').select('*')
    if category.lower() not in ["all", "discover"]:
        query = query.eq('category', category.title())
    if search:
        query = query.ilike('Keyword', f'%{search}%')
    res = query.execute()
    data = res.data
    random.shuffle(data)
    return data[:50]

# ==================== SIMPLIFIED BOT COMMANDS ====================

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
    """Simplified premium check"""
    telegram_id = message.from_user.id
    print(f"🤖 Bot: Checking premium for user {telegram_id}")
    
    try:
        # Direct query to database
        result = supabase.table("users") \
            .select("is_premium, premium_expires_at") \
            .eq("telegram_id", telegram_id) \
            .execute()
        
        print(f"🤖 Bot: Query result: {result.data}")
        
        is_premium = False
        days_left = 0
        
        if result.data:
            user = result.data[0]
            print(f"🤖 Bot: User found: {user}")
            
            if user.get("is_premium") and user.get("premium_expires_at"):
                try:
                    expires_at = datetime.fromisoformat(user["premium_expires_at"].replace("Z", "+00:00"))
                    now = datetime.utcnow()
                    
                    if expires_at > now:
                        is_premium = True
                        days_left = (expires_at - now).days
                        print(f"🤖 Bot: User has premium! Days left: {days_left}")
                except Exception as e:
                    print(f"🤖 Bot: Date error: {e}")
        
        if is_premium:
            await message.answer(
                f"✨ <b>Premium Status</b>\n\n"
                f"✅ You are a <b>Premium Member</b>!\n"
                f"⏳ Days remaining: <b>{days_left}</b> day(s)\n\n"
                f"Enjoy your ad-free experience! 🎉",
                parse_mode="HTML"
            )
        else:
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
                "💫 <b>Price:</b> 149 Stars (30 days)\n\n"
                "Click 'Get Premium' to upgrade!",
                parse_mode="HTML",
                reply_markup=keyboard
            )
            
    except Exception as e:
        print(f"🤖 Bot: Error: {e}")
        await message.answer("❌ Error checking premium status. Please try again.")

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
        prices=[LabeledPrice(label="Premium Access", amount=149)]
    )
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💳 Pay Now", url=invoice_link)],
        [InlineKeyboardButton(text="🔙 Back", callback_data="back_to_premium")]
    ])
    
    await call.message.edit_text(
        "✨ <b>Upgrade to IMAGIFHUB Premium</b>\n\n"
        "💫 <b>Price:</b> 149 Stars (30 days)\n\n"
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

# ==================== PAYMENT HANDLERS ====================

@dp.pre_checkout_query()
async def on_pre_checkout_query(pre_checkout_query: PreCheckoutQuery):
    await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)

@dp.message(F.content_type == ContentType.SUCCESSFUL_PAYMENT)
async def on_successful_payment(message: Message):
    try:
        payment = message.successful_payment
        telegram_id = message.from_user.id
        
        # Calculate expiry (30 days from now)
        expires_at = datetime.utcnow() + timedelta(days=30)
        
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

        # Update or create user with premium
        supabase.table("users").upsert({
            "telegram_id": telegram_id,
            "is_premium": True,
            "premium_expires_at": expires_at.isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).execute()

        await message.answer(
            "🎉 Payment successful! You are now an IMAGIFHUB Premium member!\n\n"
            "✅ Your premium access is active for 30 days.\n"
            "✅ Ads have been removed from your experience.\n\n"
            "To refresh your premium status in the app:\n"
            "1. Close and reopen the IMAGIFHUB Mini App\n"
            "2. Or tap 'Check Premium Status' button\n\n"
            "Use /premium anytime to check your status."
        )
        
    except Exception as e:
        print(f"Payment error: {e}")
        await message.answer("Payment received, but there was an error activating premium. Please contact support.")

# ==================== WEBHOOK HANDLERS ====================

@app.post("/api/telegram-webhook")
async def handle_webhook(request: Request):
    """Handles incoming messages from Telegram"""
    try:
        data = await request.json()
        update = Update(**data)
        await dp.feed_update(bot, update)
        return {"ok": True}
    except Exception as e:
        print(f"Webhook Error: {e}")
        return {"ok": False, "error": str(e)}

@app.get("/api/set-webhook")
async def set_webhook(request: Request):
    host = request.headers.get("host")
    url = f"https://{host}/api/telegram-webhook"
    await bot.set_webhook(url=url, drop_pending_updates=True)
    return {"status": "Webhook updated", "new_url": url}
