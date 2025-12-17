import os
import asyncio
import logging
import requests
from fastapi import FastAPI, Request
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.default import DefaultBotProperties
import sqlite3
from datetime import datetime
import uvicorn

logging.basicConfig(level=logging.INFO)

# ==================== CONFIG ====================
BOT_TOKEN = os.environ["BOT_TOKEN"]
ADMIN_ID = int(os.environ["ADMIN_ID"])
IMGBB_API_KEY = os.environ["IMGBB_API_KEY"]

bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
storage = MemoryStorage()
dp = Dispatcher(storage=storage)
app = FastAPI()

# ==================== DATABASE ====================
conn = sqlite3.connect("imagifhub.db", check_same_thread=False)
c = conn.cursor()
c.execute('''CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT, type TEXT, category TEXT, keywords TEXT,
    likes INTEGER DEFAULT 0, uploaded_at TEXT
)''')
conn.commit()

# ==================== STATES ====================
class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

CATEGORIES = [
    "Nature", "Space", "City", "Superhero", "Supervillain", "Robotic",
    "Anime", "Cars", "Wildlife", "Funny", "Seasonal Greetings",
    "Dark Aesthetic", "Luxury", "Gaming", "Ancient World"
]

# ==================== ADMIN PANEL (Images Only) ====================
@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID:
        return await message.reply("Access denied.")
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Upload Image", callback_data="upload_image")]
        # Removed GIF button
    ])
    await message.reply("Welcome Admin! Upload images (up to 10 at once)", reply_markup=keyboard)

@dp.callback_query(F.data == "upload_image")
async def choose_type(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Send me the image(s) now (up to 10 at once!)")
    await state.set_state(AdminUpload.waiting_media)

# ==================== UPLOAD (Photos Only — Single or Album) ====================
@dp.message(AdminUpload.waiting_media, F.photo | F.media_group_id)
async def receive_media(message: Message, state: FSMContext, album: list[Message] | None = None):
    try:
        messages = album or [message]
        uploaded_urls = []

        for msg in messages:
            if not msg.photo:
                continue  # Skip non-photos
            file_id = msg.photo[-1].file_id
            file = await bot.get_file(file_id)
            file_bytes = await bot.download_file(file.file_path)

            file_bytes.seek(0)
            files = {'image': file_bytes.read()}
            params = {'key': IMGBB_API_KEY}
            resp = requests.post("https://api.imgbb.com/1/upload", params=params, files=files, timeout=60)
            resp.raise_for_status()
            url = resp.json()['data']['url']
            uploaded_urls.append(url)

        if not uploaded_urls:
            return await message.reply("No valid images found — try again.")

        await state.update_data(urls=uploaded_urls)

        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=cat, callback_data=f"cat_{cat}") for cat in CATEGORIES[i:i+3]]
            for i in range(0, len(CATEGORIES), 3)
        ])
        await message.reply(f"Received {len(uploaded_urls)} image(s)! Choose category:", reply_markup=keyboard)
        await state.set_state(AdminUpload.waiting_category)
    except Exception as e:
        logging.error(f"Upload error: {e}")
        await message.reply("Upload failed — try again.")

@dp.callback_query(F.data.startswith("cat_"))
async def choose_category(call: CallbackQuery, state: FSMContext):
    category = call.data[4:]
    await state.update_data(category=category)
    await call.message.edit_text(f"Category: {category}\nNow type keywords (comma separated):")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def final_step(message: Message, state: FSMContext):
    try:
        data = await state.get_data()
        keywords = message.text.strip()
        urls = data.get("urls", [])

        for url in urls:
            c.execute("INSERT INTO media (url, type, category, keywords, uploaded_at) VALUES (?, ?, ?, ?, ?)",
                      (url, "image", data['category'], keywords, datetime.now().isoformat()))
        conn.commit()

        await message.reply(f"Successfully uploaded {len(urls)} image(s)!\nCategory: {data['category']}\nKeywords: {keywords}")
        await state.clear()
    except Exception as e:
        logging.error(f"Save error: {e}")
        await message.reply("Save failed — try again.")

# ==================== API ENDPOINTS ====================
@app.get("/media")
async def get_media(category: str = "all", search: str = "", type: str = "all"):
    query = "SELECT id, url, type, category, likes FROM media WHERE 1=1"
    params = []
    if category != "all":
        query += " AND category = ?"; params.append(category)
    if search:
        query += " AND keywords LIKE ?"; params.append(f"%{search}%")
    if type != "all":
        query += " AND type = ?"; params.append(type)
    c.execute(query + " ORDER BY RANDOM() LIMIT 50", params)
    rows = c.fetchall()
    return [{"id": r[0], "url": r[1], "type": r[2], "category": r[3], "likes": r[4]} for r in rows]

@app.post("/like/{media_id}")
async def like(media_id: int):
    c.execute("UPDATE media SET likes = likes + 1 WHERE id = ?", (media_id,))
    conn.commit()
    return {"success": True}

@app.get("/")
async def health():
    return {"status": "IMAGIFHUB Live - Images Only"}

# ==================== RUN ====================
async def run_bot():
    await dp.start_polling(bot, skip_updates=True)

async def run_server():
    port = int(os.environ.get("PORT", 10000))
    config = uvicorn.Config(app, host="0.0.0.0", port=port, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()

async def main():
    await asyncio.gather(run_bot(), run_server())

if __name__ == "__main__":
    asyncio.run(main())
