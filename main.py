import os
import asyncio
import logging
import random
import requests
from fastapi import FastAPI, BackgroundTasks
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.default import DefaultBotProperties
from supabase import create_client, Client
import uvicorn

logging.basicConfig(level=logging.INFO)

# ==================== CONFIG ====================
BOT_TOKEN = os.environ["BOT_TOKEN"]
ADMIN_ID = int(os.environ["ADMIN_ID"])
IMGBB_API_KEY = os.environ["IMGBB_API_KEY"]
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

# Initialize Clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
storage = MemoryStorage()
dp = Dispatcher(storage=storage)
app = FastAPI()

class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

CATEGORIES = [
    "Nature", "Space", "City", "Superhero", "Supervillain", "Robotic",
    "Anime", "Cars", "Wildlife", "Funny", "Seasonal Greetings",
    "Dark Aesthetic", "Luxury", "Gaming", "Ancient World"
]

# ==================== HELPER: AUTO-CLEANUP ====================
async def check_and_cleanup_links():
    """Background task to remove rows if ImgBB links are broken (404)."""
    try:
        response = supabase.table('media_content').select('id, url').execute()
        for item in response.data:
            try:
                res = requests.head(item['url'], timeout=5)
                if res.status_code == 404:
                    supabase.table('media_content').delete().eq('id', item['id']).execute()
                    logging.info(f"Auto-deleted broken link ID: {item['id']}")
            except Exception:
                continue
    except Exception as e:
        logging.error(f"Cleanup error: {e}")

# ==================== BOT ADMIN LOGIC ====================
@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID:
        return await message.reply("Access denied.")
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload Image", callback_data="upload_image")],
        [InlineKeyboardButton(text="🧹 Run Cleanup", callback_data="run_cleanup")]
    ])
    await message.reply("<b>IMAGIFHUB ADMIN</b>\nManage your content below:", reply_markup=keyboard)

@dp.callback_query(F.data == "run_cleanup")
async def manual_cleanup(call: CallbackQuery):
    await call.answer("Cleanup started in background...")
    asyncio.create_task(check_and_cleanup_links())

@dp.callback_query(F.data == "upload_image")
async def start_upload(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Send up to 10 images now!")
    await state.set_state(AdminUpload.waiting_media)

@dp.message(AdminUpload.waiting_media, F.photo)
async def handle_media(message: Message, state: FSMContext):
    file_id = message.photo[-1].file_id
    file = await bot.get_file(file_id)
    file_bytes = await bot.download_file(file.file_path)
    
    # Upload to ImgBB
    files = {'image': file_bytes.read()}
    resp = requests.post("https://api.imgbb.com/1/upload", params={'key': IMGBB_API_KEY}, files=files)
    url = resp.json()['data']['url']
    
    # Store URL in state and ask for category
    data = await state.get_data()
    urls = data.get("urls", [])
    urls.append(url)
    await state.update_data(urls=urls)

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=cat, callback_data=f"cat_{cat}") for cat in CATEGORIES[i:i+3]]
        for i in range(0, len(CATEGORIES), 3)
    ])
    await message.reply(f"Image received! ({len(urls)} total). Pick a category to continue or send more images:", reply_markup=keyboard)
    await state.set_state(AdminUpload.waiting_category)

@dp.callback_query(F.data.startswith("cat_"))
async def set_category(call: CallbackQuery, state: FSMContext):
    category = call.data[4:]
    await state.update_data(category=category)
    await call.message.edit_text(f"Category: {category}\nEnter Keywords (comma separated):")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def save_to_supabase(message: Message, state: FSMContext):
    user_data = await state.get_data()
    keywords = message.text.strip()
    
    for url in user_data['urls']:
        payload = {
            "url": url,
            "category": user_data['category'],
            "Keyword": keywords,
            "Likes": 0
        }
        supabase.table('media_content').insert(payload).execute()
    
    await message.reply(f"✅ Saved {len(user_data['urls'])} images to {user_data['category']}!")
    await state.clear()

# ==================== API ENDPOINTS ====================
@app.get("/media")
async def get_media(category: str = "all", search: str = "", background_tasks: BackgroundTasks = None):
    # Trigger background cleanup occasionally
    if random.random() < 0.1 and background_tasks: 
        background_tasks.add_task(check_and_cleanup_links)

    query = supabase.table('media_content').select('*')
    
    if category.lower() != "all":
        query = query.eq('category', category.capitalize())
    if search:
        query = query.ilike('Keyword', f'%{search}%')
    
    response = query.execute()
    data = response.data
    
    # RANDOMIZATION: Shuffle results for the "Social Media" feel
    random.shuffle(data)
    
    return data[:50]

@app.get("/")
async def health():
    return {"status": "Online", "randomization": "Enabled", "auto_cleanup": "Active"}

# ==================== EXECUTION ====================
async def main():
    # Run Bot and Server together
    loop = asyncio.get_event_loop()
    loop.create_task(dp.start_polling(bot))
    
    port = int(os.environ.get("PORT", 10000))
    config = uvicorn.Config(app, host="0.0.0.0", port=port)
    server = uvicorn.Server(config)
    await server.serve()

if __name__ == "__main__":
    asyncio.run(main())
        
