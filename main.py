import os
import asyncio
import logging
import random
import requests
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, types, F
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

# Webhook Config - Ensure BASE_URL is set in your Environment Variables
BASE_URL = os.environ.get("BASE_URL") 
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

# "Featured" is excluded here because it is a universal view, not a storage category.
CATEGORIES = [
    "Nature", "Places", "Aesthetic", "Cars", "Luxury", 
    "Anime", "Animals", "Ancient", "Others"
]

# ==================== LIFESPAN ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs on Startup: Sets the Webhook and clears old updates
    if not BASE_URL:
        logging.error("BASE_URL variable is missing! Webhook will fail.")
    await bot.set_webhook(url=WEBHOOK_URL, drop_pending_updates=True)
    logging.info(f"Webhook set to: {WEBHOOK_URL}")
    yield
    # Runs on Shutdown
    await bot.delete_webhook()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== WEBHOOK ENDPOINT ====================

@app.post(WEBHOOK_PATH)
async def bot_webhook(request: Request):
    try:
        update_data = await request.json()
        update = Update.unpack(update_data)
        await dp.feed_update(bot, update)
        return {"status": "ok"}
    except Exception as e:
        logging.error(f"Webhook Error: {e}")
        return {"status": "error"}

# ==================== BOT ADMIN LOGIC ====================

@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID: 
        return
        
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload Media", callback_data="up")]
    ])
    
    await message.reply("<b>IMAGIFHUB ADMIN</b>", reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data == "up")
async def start_upload(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Please send the image(s) you want to upload.")
    await state.set_state(AdminUpload.waiting_media)

@dp.message(AdminUpload.waiting_media, F.photo)
async def handle_media(message: Message, state: FSMContext):
    file = await bot.get_file(message.photo[-1].file_id)
    file_bytes = await bot.download_file(file.file_path)
    
    resp = requests.post(
        "https://api.imgbb.com/1/upload", 
        params={'key': IMGBB_API_KEY}, 
        files={'image': file_bytes.read()}
    )
    
    url = resp.json()['data']['url']
    
    data = await state.get_data()
    urls = data.get("urls", [])
    urls.append(url)
    await state.update_data(urls=urls)
    
    # Generate keyboard with the updated CATEGORIES list
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=cat, callback_data=f"cat_{cat}") for cat in CATEGORIES[i:i+3]]
        for i in range(0, len(CATEGORIES), 3)
    ])
    
    await message.reply(f"Received {len(urls)} image(s). Pick a category:", reply_markup=keyboard)
    await state.set_state(AdminUpload.waiting_category)

@dp.callback_query(F.data.startswith("cat_"))
async def set_category(call: CallbackQuery, state: FSMContext):
    category_name = call.data[4:]
    await state.update_data(category=category_name)
    await call.message.edit_text(f"Category set to: {category_name}\nEnter Keywords (comma separated):")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def save_to_supabase(message: Message, state: FSMContext):
    user_data = await state.get_data()
    
    for url in user_data['urls']:
        supabase.table('media_content').insert({
            "url": url, 
            "category": user_data['category'], 
            "Keyword": message.text
        }).execute()
        
    await message.reply("✅ All media saved to database!")
    await state.clear()

# ==================== API ENDPOINTS ====================

@app.get("/media")
async def get_media(category: str = "all", search: str = ""):
    query = supabase.table('media_content').select('*')
    
    # "Featured" and "all" act as a global feed by skipping the category filter
    if category.lower() not in ["all", "featured"]:
        formatted_cat = category.replace("-", " ").title()
        query = query.eq('category', formatted_cat)
    
    if search:
        query = query.ilike('Keyword', f'%{search}%')
        
    response = query.execute()
    data = response.data
    
    # Randomize order for the "TikTok" feel
    random.shuffle(data)
    return data[:50]

@app.get("/")
async def health(): 
    return {"status": "Live", "webhook": WEBHOOK_URL}

# ==================== RUN ====================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
    
