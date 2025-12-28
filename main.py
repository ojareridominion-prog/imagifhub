import os
import logging
import random
import requests
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client

# Always space your work.

# ==================== CONFIGURATION ====================
logging.basicConfig(level=logging.INFO)

BOT_TOKEN = os.environ.get("BOT_TOKEN")
ADMIN_ID = int(os.environ.get("ADMIN_ID", "0"))
IMGBB_API_KEY = os.environ.get("IMGBB_API_KEY")
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

# This is the public URL Render gives you (e.g., https://imagifhub.onrender.com)
# You will set this in Render Environment Variables later.
RENDER_EXTERNAL_URL = os.environ.get("RENDER_EXTERNAL_URL")

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

# ==================== BOT LOGIC (ADMIN PANEL) ====================
CATEGORIES = [
    "Nature", "Places", "Aesthetic", "Cars", "Luxury", "Anime", "Animals", "Ancient", "Others"
]

class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID: return
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="📤 Upload Media", callback_data="up")]])
    await message.reply("<b>IMAGIFHUB ADMIN</b>\nRender System Active 🟢", reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data == "up")
async def start_upload(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Please send the image(s).")
    await state.set_state(AdminUpload.waiting_media)

@dp.message(AdminUpload.waiting_media, F.photo)
async def handle_media(message: Message, state: FSMContext):
    try:
        file = await bot.get_file(message.photo[-1].file_id)
        file_bytes = await bot.download_file(file.file_path)
        resp = requests.post("https://api.imgbb.com/1/upload", params={'key': IMGBB_API_KEY}, files={'image': file_bytes.read()})
        url = resp.json()['data']['url']
        
        data = await state.get_data()
        urls = data.get("urls", [])
        urls.append(url)
        await state.update_data(urls=urls)
        
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=c, callback_data=f"cat_{c}") for c in CATEGORIES[i:i+3]]
            for i in range(0, len(CATEGORIES), 3)
        ])
        await message.reply(f"Received. Pick category:", reply_markup=keyboard)
        await state.set_state(AdminUpload.waiting_category)
    except Exception as e:
        await message.reply(f"Error: {e}")

@dp.callback_query(F.data.startswith("cat_"))
async def set_category(call: CallbackQuery, state: FSMContext):
    await state.update_data(category=call.data[4:])
    await call.message.edit_text("Enter Keywords:")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def save_to_supabase(message: Message, state: FSMContext):
    data = await state.get_data()
    for url in data.get('urls', []):
        supabase.table('media_content').insert({
            "url": url, "category": data['category'], "Keyword": message.text
        }).execute()
    await message.reply("✅ Saved!")
    await state.clear()

# ==================== WEBHOOK & API ====================

@app.on_event("startup")
async def on_startup():
    """Automatically sets the webhook when the server starts"""
    if RENDER_EXTERNAL_URL:
        webhook_url = f"{RENDER_EXTERNAL_URL}/api/webhook"
        await bot.set_webhook(webhook_url)
        logging.info(f"Webhook set to: {webhook_url}")

@app.post("/api/webhook")
async def telegram_webhook(request: Request):
    try:
        data = await request.json()
        update = types.Update(**data)
        await dp.feed_update(bot=bot, update=update)
        return {"ok": True}
    except Exception as e:
        logging.error(f"Webhook error: {e}")
        return {"ok": False}

@app.get("/api/media")
async def get_media(category: str = "all", search: str = ""):
    query = supabase.table('media_content').select('*')
    if category.lower() not in ["all", "featured"]:
        query = query.eq('category', category.replace("-", " ").title())
    if search:
        query = query.ilike('Keyword', f'%{search}%')
    data = query.execute().data
    random.shuffle(data)
    return data[:50]

@app.get("/api/health")
async def health():
    return {"status": "Live on Render"}

# This allows you to run the file directly locally if needed
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
  
