import os
import logging
import random
import requests
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, Update, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client

# Always space your work.

# ==================== CONFIG ====================
BOT_TOKEN = os.environ["BOT_TOKEN"]
ADMIN_ID = int(os.environ["ADMIN_ID"])
IMGBB_API_KEY = os.environ["IMGBB_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

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

# Must match your script.js categories exactly
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
    """Run this once in your browser to link the bot to Vercel"""
    host = request.headers.get("host")
    url = f"https://{host}/api/telegram-webhook"
    await bot.set_webhook(url=url, drop_pending_updates=True)
    return {"status": "Webhook updated", "new_url": url}

# ==================== FRONTEND API ====================

@app.get("/media")
async def get_media(category: str = "all", search: str = ""):
    """The full endpoint for your script.js to load images"""
    query = supabase.table('media_content').select('*')
    
    # Category Filter
    if category.lower() not in ["all", "discover"]:
        query = query.eq('category', category.title())
    
    # Search Filter
    if search:
        query = query.ilike('Keyword', f'%{search}%')
        
    res = query.execute()
    data = res.data
    
    # Shuffling the data before sending to frontend
    random.shuffle(data)
    
    # Return 50 items
    return data[:50]

# ==================== BOT LOGIC (ADMIN PANEL) ====================

@dp.message(F.text == "/start")
async def cmd_start(message: Message):
    await message.answer("IMAGIFHUB isn't just an app—it’s your personal portal to a world of endless, breathtaking beauty. Don't wait, click let's go 🚀🚀 to continue")

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
    # Get the highest resolution photo
    file_id = message.photo[-1].file_id
    file = await bot.get_file(file_id)
    
    # Use Telegram's file server for the ImgBB upload
    media_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file.file_path}"
    
    resp = requests.post(
        "https://api.imgbb.com/1/upload", 
        params={'key': IMGBB_API_KEY, 'image': media_url}
    )
    
    if resp.status_code == 200:
        final_url = resp.json()['data']['url']
        await state.update_data(url=final_url)
        
        # Build category selection buttons
        btns = []
        for i in range(0, len(CATEGORIES), 2):
            row = [InlineKeyboardButton(text=c, callback_data=f"set_{c}") for c in CATEGORIES[i:i+2]]
            btns.append(row)
        
        await message.answer("Select the Category:", reply_markup=InlineKeyboardMarkup(inline_keyboard=btns))
        await state.set_state(AdminUpload.waiting_category)
    else:
        await message.answer("❌ Error uploading to ImgBB. Check your API Key.")

@dp.callback_query(F.data.startswith("set_"))
async def up_step3(call: CallbackQuery, state: FSMContext):
    category = call.data.split("_")[1]
    await state.update_data(category=category)
    await call.message.edit_text(f"Category set to: {category}\nNow type the keywords (e.g. 'cool, red, car'):")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def up_final(message: Message, state: FSMContext):
    user_data = await state.get_data()
    
    # Save to Supabase
    supabase.table('media_content').insert({
        "url": user_data['url'],
        "category": user_data['category'],
        "Keyword": message.text
    }).execute()
    
    await message.answer(f"✅ Successfully added to {user_data['category']}!")
    await state.clear()
    
