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
from aiogram.utils.token import TokenValidationError

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

        await message.answer("🎉 Payment successful! You are now an IMAGIFHUB Premium member.")
        
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

# ==================== INVOICE ENDPOINT ====================

@app.post("/api/create-invoice")
async def create_invoice(request: Request):
    try:
        data = await request.json()
        user_id = data.get("user_id")
        
        if not user_id:
            raise HTTPException(status_code=400, detail="User ID required")
        
        # Create the invoice link
        invoice_link = await bot.create_invoice_link(
            title="IMAGIFHUB Premium",
            description="30 days of ad-free experience",
            payload=f"premium_{user_id}",
            provider_token="",  # Empty for Telegram Stars
            currency="XTR",     # Telegram Stars currency
            prices=[LabeledPrice(label="Premium Access", amount=149)]
        )
        
        return {"invoice_url": invoice_link}
        
    except Exception as e:
        logging.error(f"Create invoice error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== BOT LOGIC (ADMIN PANEL) ====================

@dp.message(F.text == "/start")
async def cmd_start(message: Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Let's Go!", web_app={"url": "https://ojareridominion-prog.github.io/imagifhub/"})],
        [InlineKeyboardButton(text="📢 Official channel", url="https://t.me/YourChannelUsername")],
        [InlineKeyboardButton(text="⭐ Go Premium", callback_data="premium")]
    ])
    await message.answer(
        "IMAGIFHUB isn't just an app—it's your personal portal to a world of endless, breathtaking beauty.\n\nDon't wait, click let's go 🚀🚀 to continue",
        reply_markup=keyboard
    )

@dp.callback_query(F.data == "premium")
async def premium_callback(call: CallbackQuery):
    # Create invoice for this user
    invoice_link = await bot.create_invoice_link(
        title="IMAGIFHUB Premium",
        description="30 days of ad-free experience",
        payload=f"premium_{call.from_user.id}",
        provider_token="",
        currency="XTR",
        prices=[LabeledPrice(label="Premium Access", amount=149)]
    )
    
    await call.message.answer(
        "✨ Upgrade to Premium for an ad-free experience!\n\n"
        f"Click here to pay: {invoice_link}",
        parse_mode="HTML"
    )
    await call.answer()

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
