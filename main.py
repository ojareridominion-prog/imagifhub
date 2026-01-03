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

# Pre-checkout handler
@dp.pre_checkout_query()
async def on_pre_checkout_query(pre_checkout_query: PreCheckoutQuery):
    await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)

# Successful payment handler
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
            "transaction_id": payment.telegram_payment_charge_id
        }).execute()

        # Update User Premium Status
        supabase.table("users").upsert({
            "telegram_id": telegram_id,
            "is_premium": True,
            "premium_expires_at": expires_at.isoformat()
        }).execute()

        # Send congratulatory message with premium status
        await message.answer(
            "🎉 Payment successful! You are now an IMAGIFHUB Premium member!\n\n"
            "Your premium access is active for 30 days. "
            "Use /premium to check your status anytime."
        )
        
    except Exception as e:
        logging.error(f"Payment DB Error: {e}")
        await message.answer("Payment received, but there was an error activating premium. Please contact support.")

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

# ==================== BOT LOGIC ====================

@dp.message(F.text == "/start")
async def cmd_start(message: Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Let's Go!", web_app={"url": "https://imagifhub.vercel.app/"})],
        [InlineKeyboardButton(text="📢 Official channel", url="https://t.me/imagifhub")],
        [InlineKeyboardButton(text="⭐ Check Premium", callback_data="check_premium")]
    ])
    await message.answer(
        "IMAGIFHUB isn't just an app—it's your personal portal to a world of endless, breathtaking beauty.\n\n"
        "Don't wait, click let's go 🚀🚀 to continue",
        reply_markup=keyboard
    )

@dp.message(F.text == "/premium")
async def cmd_premium(message: Message):
    """Check premium status or purchase premium"""
    telegram_id = message.from_user.id
    
    try:
        # Check user's premium status
        user_result = supabase.table("users").select("*").eq("telegram_id", telegram_id).execute()
        
        if user_result.data and len(user_result.data) > 0:
            user_data = user_result.data[0]
            
            if user_data.get("is_premium") and user_data.get("premium_expires_at"):
                # User is premium - calculate remaining days
                expires_at = datetime.fromisoformat(user_data["premium_expires_at"].replace("Z", "+00:00"))
                now = datetime.utcnow()
                
                if expires_at > now:
                    # Still active
                    days_left = (expires_at - now).days
                    await message.answer(
                        f"✨ <b>Premium Status</b>\n\n"
                        f"✅ You are a <b>Premium Member</b>!\n"
                        f"⏳ Days remaining: <b>{days_left}</b> day(s)\n"
                        f"📅 Expires on: {expires_at.strftime('%Y-%m-%d')}\n\n"
                        f"Enjoy your ad-free experience! 🎉",
                        parse_mode="HTML"
                    )
                else:
                    # Premium expired
                    keyboard = InlineKeyboardMarkup(inline_keyboard=[
                        [InlineKeyboardButton(text="🔄 Renew Premium", callback_data="renew_premium")]
                    ])
                    await message.answer(
                        "⚠️ Your premium subscription has expired.\n\n"
                        "Renew now to continue enjoying ad-free experience!",
                        reply_markup=keyboard
                    )
            else:
                # Not premium
                keyboard = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="⭐ Get Premium", callback_data="get_premium")]
                ])
                await message.answer(
                    "✨ <b>IMAGIFHUB Premium</b>\n\n"
                    "🔓 You are currently on the free plan.\n"
                    "✨ Upgrade to Premium for:\n"
                    "• 🚫 No ads\n"
                    "• ⚡ Faster downloads\n"
                    "• ❤️ Support the project\n\n"
                    "Only 149 Stars for 30 days!",
                    parse_mode="HTML",
                    reply_markup=keyboard
                )
        else:
            # User not in database - not premium
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="⭐ Get Premium", callback_data="get_premium")]
            ])
            await message.answer(
                "✨ <b>IMAGIFHUB Premium</b>\n\n"
                "🔓 You are currently on the free plan.\n"
                "✨ Upgrade to Premium for:\n"
                "• 🚫 No ads\n"
                "• ⚡ Faster downloads\n"
                "• ❤️ Support the project\n\n"
                "Only 149 Stars for 30 days!",
                parse_mode="HTML",
                reply_markup=keyboard
            )
            
    except Exception as e:
        logging.error(f"Premium check error: {e}")
        await message.answer("❌ Error checking premium status. Please try again.")

@dp.callback_query(F.data == "check_premium")
async def check_premium_callback(call: CallbackQuery):
    """Handle check premium callback"""
    await call.answer()
    await cmd_premium(call.message)

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
        [InlineKeyboardButton(text="🔙 Back", callback_data="check_premium")]
    ])
    
    await call.message.edit_text(
        "✨ <b>Upgrade to IMAGIFHUB Premium</b>\n\n"
        "Price: <b>149 Stars</b> (30 days)\n\n"
        "<b>Benefits:</b>\n"
        "• 🚫 No ads\n"
        "• ⚡ Faster downloads\n"
        "• ❤️ Support the project\n\n"
        "Click 'Pay Now' to complete your purchase.",
        parse_mode="HTML",
        reply_markup=keyboard
    )

@dp.callback_query(F.data == "renew_premium")
async def renew_premium_callback(call: CallbackQuery):
    """Renew premium subscription"""
    await get_premium_callback(call)

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

# Run payment status check periodically
async def check_expired_premium():
    """Check and update expired premium users"""
    try:
        now = datetime.utcnow().isoformat()
        # Find users whose premium has expired
        expired_users = supabase.table("users").select("*").lt("premium_expires_at", now).eq("is_premium", True).execute()
        
        if expired_users.data:
            for user in expired_users.data:
                # Update their status
                supabase.table("users").update({"is_premium": False}).eq("id", user["id"]).execute()
                logging.info(f"Updated expired premium for user {user['telegram_id']}")
    except Exception as e:
        logging.error(f"Error checking expired premium: {e}")

# Initialize the bot with periodic task
async def on_startup():
    # Schedule premium status check
    asyncio.create_task(check_expired_premium())
