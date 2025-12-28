import os
import logging
import random
import requests
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

logging.basicConfig(level=logging.INFO)

# ==================== CONFIGURATION ====================

# 1. Load Environment Variables
BOT_TOKEN = os.environ.get("BOT_TOKEN")
# Admin ID must be an integer. We use a default of 0 if missing to prevent crash, 
# but you MUST set this in Vercel for the admin panel to work.
ADMIN_ID = int(os.environ.get("ADMIN_ID", "0")) 
IMGBB_API_KEY = os.environ.get("IMGBB_API_KEY")
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

# 2. Initialize Clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())
app = FastAPI()

# 3. CORS (Allows your frontend to talk to this backend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== DATA & STATES ====================

# Restoring your original Categories
CATEGORIES = [
    "Nature", "Places", "Aesthetic", "Cars", "Luxury", "Anime", "Animals", "Ancient", "Others"
]

# Restoring your State Machine for Uploads
class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

# ==================== TELEGRAM ADMIN HANDLERS ====================

@dp.message(Command("admin"))
async def admin_panel(message: Message):
    """
    Entry point for the Admin Panel.
    Checks if the user is the ADMIN_ID set in your Env Vars.
    """
    if message.from_user.id != ADMIN_ID:
        # Silently ignore non-admins or tell them to go away
        return
        
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload Media", callback_data="up")]
    ])
    
    await message.reply("<b>IMAGIFHUB ADMIN</b>\nServerless Mode Active 🟢", reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data == "up")
async def start_upload(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Please send the image(s) you want to upload.")
    await state.set_state(AdminUpload.waiting_media)

@dp.message(AdminUpload.waiting_media, F.photo)
async def handle_media(message: Message, state: FSMContext):
    """
    Handles the image sent by the admin.
    Downloads it from Telegram servers -> Uploads to ImgBB -> Saves URL in memory.
    """
    try:
        # 1. Get file from Telegram
        file = await bot.get_file(message.photo[-1].file_id)
        # 2. Download file bytes
        file_bytes_io = await bot.download_file(file.file_path)
        file_bytes = file_bytes_io.read()
        
        # 3. Upload to ImgBB (Synchronous request)
        # Note: In heavy production, this should be async, but for admin usage, it's fine.
        resp = requests.post(
            "https://api.imgbb.com/1/upload", 
            params={'key': IMGBB_API_KEY}, 
            files={'image': file_bytes}
        )
        
        resp_data = resp.json()
        if 'data' not in resp_data:
            await message.reply(f"ImgBB Upload Failed: {resp_data}")
            return

        url = resp_data['data']['url']
        
        # 4. Save to temporary state
        data = await state.get_data()
        urls = data.get("urls", [])
        urls.append(url)
        await state.update_data(urls=urls)
        
        # 5. Show Categories
        # Creates a grid of buttons (3 per row)
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=cat, callback_data=f"cat_{cat}") for cat in CATEGORIES[i:i+3]]
            for i in range(0, len(CATEGORIES), 3)
        ])
        
        await message.reply(f"Received {len(urls)} image(s). Pick a category:", reply_markup=keyboard)
        await state.set_state(AdminUpload.waiting_category)
        
    except Exception as e:
        logging.error(f"Upload Error: {e}")
        await message.reply(f"Error during upload: {str(e)}")

@dp.callback_query(F.data.startswith("cat_"))
async def set_category(call: CallbackQuery, state: FSMContext):
    # Extract category name from callback data "cat_Nature" -> "Nature"
    category_selected = call.data[4:]
    await state.update_data(category=category_selected)
    
    await call.message.edit_text(f"Selected: {category_selected}\nNow enter Keywords (separated by commas):")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def save_to_supabase(message: Message, state: FSMContext):
    """
    Final step: Save the URL + Category + Keywords to Supabase.
    """
    user_data = await state.get_data()
    keywords = message.text
    
    saved_count = 0
    errors = []

    for url in user_data.get('urls', []):
        try:
            supabase.table('media_content').insert({
                "url": url, 
                "category": user_data['category'], 
                "Keyword": keywords
            }).execute()
            saved_count += 1
        except Exception as e:
            errors.append(str(e))
            
    if errors:
        await message.reply(f"⚠️ Some errors occurred:\n{', '.join(errors)}")
    else:
        await message.reply(f"✅ Success! Saved {saved_count} images to database.")
        
    await state.clear()

# ==================== API ENDPOINTS ====================

# 1. THE WEBHOOK (Vital for the Bot to work on Vercel)
@app.post("/api/webhook")
async def telegram_webhook(request: Request):
    """
    This is where Telegram sends updates (messages, button clicks).
    We feed them into the aiogram Dispatcher (dp).
    """
    try:
        update_data = await request.json()
        telegram_update = types.Update(**update_data)
        await dp.feed_update(bot, telegram_update)
        return {"ok": True}
    except Exception as e:
        logging.error(f"Webhook error: {e}")
        return {"ok": False, "error": str(e)}

# 2. THE MEDIA API (For your website)
@app.get("/api/media")
async def get_media(category: str = "all", search: str = ""):
    try:
        query = supabase.table('media_content').select('*')
        
        # "Featured" and "all" act as a global feed
        if category.lower() not in ["all", "featured"]:
            formatted_cat = category.replace("-", " ").title()
            query = query.eq('category', formatted_cat)
        
        if search:
            query = query.ilike('Keyword', f'%{search}%')
            
        response = query.execute()
        data = response.data
        
        # Randomize order
        random.shuffle(data)
        
        # Return top 50
        return data[:50]
        
    except Exception as e:
        logging.error(f"Database error: {e}")
        return {"error": str(e)}

# 3. HEALTH CHECK
@app.get("/api/health")
async def health(): 
    return {"status": "Live", "mode": "Serverless"}
        
