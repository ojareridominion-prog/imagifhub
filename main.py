import os
import asyncio
import logging
import random
import requests
from fastapi import FastAPI, BackgroundTasks, Body
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client
import uvicorn

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
    allow_methods=["*"],
    allow_headers=["*"],
)

class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

CATEGORIES = ["Nature", "Space", "City", "Superhero", "Supervillain", "Robotic", "Anime", "Cars", "Wildlife", "Funny", "Seasonal Greetings", "Dark Aesthetic", "Luxury", "Gaming", "Ancient World"]

# ==================== BOT ADMIN LOGIC ====================
@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID: return
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload", callback_data="up")]
    ])
    await message.reply("<b>ADMIN PANEL</b>", reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data == "up")
async def start_upload(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Send the image(s) now!")
    await state.set_state(AdminUpload.waiting_media)

@dp.message(AdminUpload.waiting_media, F.photo)
async def handle_media(message: Message, state: FSMContext):
    file = await bot.get_file(message.photo[-1].file_id)
    file_bytes = await bot.download_file(file.file_path)
    resp = requests.post("https://api.imgbb.com/1/upload", params={'key': IMGBB_API_KEY}, files={'image': file_bytes.read()})
    url = resp.json()['data']['url']
    data = await state.get_data()
    urls = data.get("urls", [])
    urls.append(url)
    await state.update_data(urls=urls)
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=cat, callback_data=f"cat_{cat}") for cat in CATEGORIES[i:i+3]]
        for i in range(0, len(CATEGORIES), 3)
    ])
    await message.reply(f"Received! ({len(urls)} total). Pick a category:", reply_markup=keyboard)
    await state.set_state(AdminUpload.waiting_category)

@dp.callback_query(F.data.startswith("cat_"))
async def set_category(call: CallbackQuery, state: FSMContext):
    await state.update_data(category=call.data[4:])
    await call.message.edit_text("Enter Keywords (comma separated):")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def save_to_supabase(message: Message, state: FSMContext):
    user_data = await state.get_data()
    for url in user_data['urls']:
        supabase.table('media_content').insert({
            "url": url, "category": user_data['category'], 
            "Keyword": message.text, "Likes": 0
        }).execute()
    await message.reply("✅ Saved successfully!")
    await state.clear()

# ==================== API ENDPOINTS ====================

@app.get("/media")
async def get_media(category: str = "all", search: str = ""):
    query = supabase.table('media_content').select('*')
    if category.lower() != "all":
        formatted_cat = category.replace("-", " ").title()
        query = query.eq('category', formatted_cat)
    if search:
        query = query.ilike('Keyword', f'%{search}%')
    response = query.execute()
    data = response.data
    random.shuffle(data) 
    return data[:50]

@app.post("/like/{media_id}")
async def like_media(media_id: int):
    # Fetch current likes
    res = supabase.table('media_content').select('Likes').eq('id', media_id).single().execute()
    new_count = (res.data.get('Likes') or 0) + 1
    # Update likes
    supabase.table('media_content').update({"Likes": new_count}).eq('id', media_id).execute()
    return {"status": "success", "new_likes": new_count}

@app.post("/playlist/add")
async def add_to_playlist(payload: dict = Body(...)):
    # payload: {"user_id": int, "media_id": int}
    supabase.table('user_playlists').upsert({
        "user_id": payload['user_id'],
        "media_id": payload['media_id']
    }).execute()
    return {"status": "added"}

@app.get("/playlist/{user_id}")
async def get_playlist(user_id: int):
    # Get media IDs from playlist
    res = supabase.table('user_playlists').select('media_id').eq('user_id', user_id).execute()
    ids = [x['media_id'] for x in res.data]
    if not ids: return []
    # Fetch media details
    media_res = supabase.table('media_content').select('*').in_('id', ids).execute()
    return media_res.data

@app.get("/")
async def health(): return {"status": "Live"}

# ==================== RUN ====================
async def main():
    asyncio.create_task(dp.start_polling(bot))
    port = int(os.environ.get("PORT", 10000))
    config = uvicorn.Config(app, host="0.0.0.0", port=port)
    server = uvicorn.Server(config)
    await server.serve()

if __name__ == "__main__":
    asyncio.run(main())
    
