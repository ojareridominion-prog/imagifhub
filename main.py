import os
import asyncio
import logging
import cloudinary
import cloudinary.uploader
from fastapi import FastAPI, Request
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import (
    BufferedInputFile, Message, CallbackQuery,
    InlineKeyboardMarkup, InlineKeyboardButton
)
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

cloudinary.config(
    cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"],
    api_key=os.environ["CLOUDINARY_API_KEY"],
    api_secret=os.environ["CLOUDINARY_API_SECRET"]
)

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

# ==================== ADMIN STATES ====================
class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

CATEGORIES = ["Nature","Space","City","Superhero","Supervillain","Robotic","Anime","Cars","Wildlife","Funny","Seasonal Greetings","Dark Aesthetic","Luxury","Gaming","Ancient World"]

# ==================== ADMIN HANDLERS ====================
@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID:
        return await message.reply("Access denied.")
    await message.reply(
        "Welcome Admin! What do you want to upload?",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [[InlineKeyboardButton(text="Upload Image", callback_data="upload_image")]],
            [[InlineKeyboardButton(text="Upload GIF", callback_data="upload_gif")]]
        ])
    )

# (the rest of your admin handlers stay exactly the same — I shortened them here for space but keep your full ones)

# ==================== API ENDPOINTS ====================
@app.get("/media")
async def get_media(category: str = "all", type: str = "all"):
    query = "SELECT id, url, type, category, likes FROM media WHERE 1=1"
    params = []
    if category != "all":
        query += " AND category = ?"; params.append(category)
    if type != "all":
        query += " AND type = ?"; params.append(type)
    c.execute(query + " ORDER BY RANDOM() LIMIT 50", params)
    rows = c.fetchall()
    return [{"id":r[0],"url":r[1],"type":r[2],"category":r[3],"likes":r[4]} for r in rows]

@app.post("/like/{media_id}")
async def like(media_id: int):
    c.execute("UPDATE media SET likes = likes + 1 WHERE id = ?", (media_id,))
    conn.commit()
    return {"success": True}

@app.get("/")
async def health():
    return {"status": "OK"}

# ==================== RUN BOTH BOT + WEB ====================
async def start_bot():
    await dp.start_polling(bot)

async def main():
    # Start the Telegram bot in background
    bot_task = asyncio.create_task(start_bot())
    # Start FastAPI (this keeps Render happy)
    config = uvicorn.Config(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
    server = uvicorn.Server(config)
    await server.serve()

if __name__ == "__main__":
    asyncio.run(main())
