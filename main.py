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
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

# Make sure BASE_URL is your actual Render URL (e.g., https://your-app.onrender.com)
BASE_URL = os.environ.get("BASE_URL", "").rstrip("/") 
WEBHOOK_PATH = f"/webhook/{BOT_TOKEN}"
WEBHOOK_URL = f"{BASE_URL}{WEBHOOK_PATH}"

# Initialize Clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())

# ==================== STATES & CATEGORIES ====================

class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

CATEGORIES = ["Nature", "Places", "Aesthetic", "Cars", "Luxury", "Anime", "Animals", "Ancient", "Others"]

# ==================== LIFESPAN ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Set webhook on startup
    if BASE_URL:
        await bot.set_webhook(url=WEBHOOK_URL, drop_pending_updates=True)
        logging.info(f"✅ Webhook active: {WEBHOOK_URL}")
    else:
        logging.warning("⚠️ BASE_URL not found. Webhook not set.")
    yield
    # Cleanup
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
        data = await request.json()
        update = Update.unpack(data)
        await dp.feed_update(bot, update)
        return {"status": "ok"}
    except Exception as e:
        logging.error(f"Webhook processing error: {e}")
        return {"status": "error", "message": str(e)}

# ==================== BOT HANDLERS ====================

@dp.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer("Welcome to ImagifHub! Use /admin if you are the owner.")

@dp.message(Command("admin"))
async def admin_panel(message: Message, state: FSMContext):
    # Security Check
    if message.from_user.id != ADMIN_ID:
        return await message.reply("❌ Access Denied.")
    
    # Force clear state in case the admin was stuck in a previous upload
    await state.clear()
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload Media", callback_data="up")]
    ])
    await message.reply("<b>IMAGIFHUB ADMIN PANEL</b>", reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data == "up")
async def start_upload(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Please send the photo you want to upload.")
    await state.set_state(AdminUpload.waiting_media)

@dp.message(AdminUpload.waiting_media, F.photo)
async def handle_media(message: Message, state: FSMContext):
    # Download and upload to ImgBB
    file = await bot.get_file(message.photo[-1].file_id)
    file_content = await bot.download_file(file.file_path)
    
    resp = requests.post(
        "https://api.imgbb.com/1/upload", 
        params={'key': IMGBB_API_KEY}, 
        files={'image': file_content.read()}
    )
    
    img_url = resp.json()['data']['url']
    await state.update_data(urls=[img_url])
    
    # Category buttons
    btns = []
    for i in range(0, len(CATEGORIES), 2):
        row = [InlineKeyboardButton(text=c, callback_data=f"cat_{c}") for c in CATEGORIES[i:i+2]]
        btns.append(row)
    
    await message.reply("Select a category for this image:", reply_markup=InlineKeyboardMarkup(inline_keyboard=btns))
    await state.set_state(AdminUpload.waiting_category)

@dp.callback_query(F.data.startswith("cat_"))
async def set_category(call: CallbackQuery, state: FSMContext):
    cat = call.data[4:]
    await state.update_data(category=cat)
    await call.message.edit_text(f"Category: {cat}\nNow send keywords (e.g. sunset, sea, blue):")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def save_media(message: Message, state: FSMContext):
    data = await state.get_data()
    supabase.table('media_content').insert({
        "url": data['urls'][0],
        "category": data['category'],
        "Keyword": message.text
    }).execute()
    
    await message.reply("✅ Successfully saved to Supabase!")
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
    items = res.data
    random.shuffle(items)
    return items[:40]

@app.get("/")
async def health():
    return {"status": "Online", "webhook_url": WEBHOOK_URL}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
    
