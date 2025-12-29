import os
import asyncio
import logging
import random
import requests
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import Message, Update, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client
import uvicorn

# Always space your work.

logging.basicConfig(level=logging.INFO)

# ==================== CONFIG ====================

BOT_TOKEN = os.environ["BOT_TOKEN"]
ADMIN_ID = int(os.environ["ADMIN_ID"])
IMGBB_API_KEY = os.environ["IMGBB_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

# [span_0](start_span)Matches the path Telegram is already looking for in your screenshot[span_0](end_span)
BASE_URL = os.environ.get("BASE_URL", "https://imagifhub.onrender.com").rstrip("/")
WEBHOOK_PATH = "/api/telegram-webhook"
WEBHOOK_URL = f"{BASE_URL}{WEBHOOK_PATH}"

# Initialize Clients
# Note: Using 'supabase' package as specified in requirements.txt
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())

# ==================== STATES & CATEGORIES ====================

class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

CATEGORIES = [
    "Nature", "Places", "Aesthetic", "Cars", "Luxury", 
    "Anime", "Animals", "Ancient", "Others"
]

# ==================== LIFESPAN (WEBHOOK SETUP) ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # This forces Telegram to send updates to your specific Render URL
    if BASE_URL:
        logging.info(f"Setting webhook to: {WEBHOOK_URL}")
        await bot.set_webhook(
            url=WEBHOOK_URL, 
            drop_pending_updates=True,
            allowed_updates=["message", "callback_query"]
        )
    else:
        logging.error("BASE_URL environment variable is missing!")
    
    yield
    # Cleanup on shutdown
    await bot.delete_webhook()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== WEBHOOK ENDPOINT ====================

@app.post(WEBHOOK_PATH)
async def bot_webhook(request: Request):
    try:
        update_data = await request.json()
        update = Update.unpack(update_data)
        # Feeds the Telegram update into the Aiogram dispatcher
        await dp.feed_update(bot, update)
        return {"status": "ok"}
    except Exception as e:
        logging.error(f"Webhook Error: {e}")
        return {"status": "error", "message": str(e)}

# ==================== BOT HANDLERS ====================

@dp.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer("Welcome to ImagifHub! Use /admin to upload content.")

@dp.message(Command("admin"))
async def admin_panel(message: Message, state: FSMContext):
    # Ensure this matches your ID: 6403924487
    if message.from_user.id != ADMIN_ID:
        logging.warning(f"Unauthorized admin access attempt by {message.from_user.id}")
        return
    
    await state.clear() 
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload New Media", callback_data="up")]
    ])
    await message.reply("<b>Admin Panel</b>\nClick below to start.", reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data == "up")
async def start_upload(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Send the photo you want to upload.")
    await state.set_state(AdminUpload.waiting_media)

@dp.message(AdminUpload.waiting_media, F.photo)
async def handle_media(message: Message, state: FSMContext):
    # Get the highest resolution photo
    file = await bot.get_file(message.photo[-1].file_id)
    file_bytes = await bot.download_file(file.file_path)
    
    # Upload to ImgBB
    resp = requests.post(
        "https://api.imgbb.com/1/upload", 
        params={'key': IMGBB_API_KEY}, 
        files={'image': file_bytes.read()}
    )
    
    try:
        url = resp.json()['data']['url']
        await state.update_data(url=url)
        
        btns = []
        for i in range(0, len(CATEGORIES), 2):
            row = [InlineKeyboardButton(text=c, callback_data=f"cat_{c}") for c in CATEGORIES[i:i+2]]
            btns.append(row)
        
        await message.reply("Select a category:", reply_markup=InlineKeyboardMarkup(inline_keyboard=btns))
        await state.set_state(AdminUpload.waiting_category)
    except Exception as e:
        logging.error(f"ImgBB Upload Error: {e}")
        await message.reply("Failed to upload image to ImgBB. Check your API key.")

@dp.callback_query(F.data.startswith("cat_"))
async def set_category(call: CallbackQuery, state: FSMContext):
    cat = call.data[4:]
    await state.update_data(category=cat)
    await call.message.edit_text(f"Category: {cat}\nNow send keywords (comma separated):")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def save_media(message: Message, state: FSMContext):
    data = await state.get_data()
    # Inserts content into Supabase media_content table
    supabase.table('media_content').insert({
        "url": data['url'],
        "category": data['category'],
        "Keyword": message.text
    }).execute()
    
    await message.reply("✅ Saved to database!")
    await state.clear()

# ==================== API ENDPOINTS ====================

@app.get("/media")
async def get_media(category: str = "all", search: str = ""):
    query = supabase.table('media_content').select('*')
    
    if category.lower() not in ["all", "featured"]:
        query = query.eq('category', category.title())
    
    if search:
        query = query.ilike('Keyword', f'%{search}%')
        
    res = query.execute()
    data = res.data
    random.shuffle(data)
    return data[:50]

@app.get("/")
async def health():
    return {
        "status": "Live", 
        "webhook_url": WEBHOOK_URL,
        "configured_admin": ADMIN_ID
    }

# ==================== RUN ====================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
