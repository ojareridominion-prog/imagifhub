import os
import asyncio
import logging
import random
import requests
from fastapi import FastAPI, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
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

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

# Cleaned list to avoid SyntaxError: invalid non-printable character
CATEGORIES = [
    "Nature", "Places", "Aesthetic", "Cars", "Luxury", "Anime", "Animals", "Ancient", "Others"
]

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
    
    # Create category buttons for selection
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=cat, callback_data=f"cat_{cat}") for cat in CATEGORIES[i:i+3]]
        for i in range(0, len(CATEGORIES), 3)
    ])
    
    await message.reply(f"Received {len(urls)} image(s). Pick a category:", reply_markup=keyboard)
    await state.set_state(AdminUpload.waiting_category)

@dp.callback_query(F.data.startswith("cat_"))
async def set_category(call: CallbackQuery, state: FSMContext):
    await state.update_data(category=call.data[4:])
    await call.message.edit_text("Enter Keywords (separated by commas):")
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
    
    # [span_2](start_span)[span_3](start_span)"Featured" and "all" now act as a global feed[span_2](end_span)[span_3](end_span)
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
    return {"status": "Live"}

# ==================== RUN ====================

async def main():
    asyncio.create_task(dp.start_polling(bot))
    port = int(os.environ.get("PORT", 10000))
    config = uvicorn.Config(app, host="0.0.0.0", port=port)
    server = uvicorn.Server(config)
    await server.serve()

if __name__ == "__main__":
    asyncio.run(main())

from aiogram.types import Update

# 1. Define your Webhook URL (Change this to your actual Render/Railway URL)
BASE_URL = "https://imagifhub.onrender.com"
WEBHOOK_PATH = f"/webhook/{BOT_TOKEN}"
WEBHOOK_URL = f"{BASE_URL}{WEBHOOK_PATH}"

# 2. Add the Webhook Handler to FastAPI
@app.post(WEBHOOK_PATH)
async def bot_webhook(update: dict):
    telegram_update = Update.unpack(update)
    await dp.feed_update(bot, telegram_update)
    return {"status": "ok"}

# 3. Setup Webhook on Startup
@app.on_event("startup")
async def on_startup():
    # Remove any existing webhooks or polling
    await bot.delete_webhook(drop_pending_updates=True)
    # Set the new webhook URL
    await bot.set_webhook(url=WEBHOOK_URL)

@app.on_event("shutdown")
async def on_shutdown():
    await bot.delete_webhook()
    
