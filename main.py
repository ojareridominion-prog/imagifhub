import os
import asyncio
import logging
import cloudinary
import cloudinary.uploader
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import FSInputFile, BufferedInputFile, Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, LabeledPrice
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.session.aiohttp import AiohttpSession
from aiohttp_socks import ProxyConnector

connector = ProxyConnector.from_url('http://proxy.server:3128')
session = AiohttpSession(connector=connector)
bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"), session=session)
dp = Dispatcher(storage=MemoryStorage())
import sqlite3
from datetime import datetime, timedelta
import uvicorn

load_dotenv()
logging.basicConfig(level=logging.INFO)

# === CONFIG ===
BOT_TOKEN = os.getenv("BOT_TOKEN")
ADMIN_ID = int(os.getenv("ADMIN_ID"))
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET")
)

bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
storage = MemoryStorage()
dp = Dispatcher(storage=storage)
app = FastAPI()

# === DATABASE ===
conn = sqlite3.connect("imagifhub.db", check_same_thread=False)
c = conn.cursor()
c.execute('''CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT, type TEXT, category TEXT, keywords TEXT,
    likes INTEGER DEFAULT 0, uploaded_at TEXT
)''')
c.execute('''CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    is_premium INTEGER DEFAULT 0,
    premium_until TEXT,
    saves_today INTEGER DEFAULT 0,
    save_date TEXT
)''')
conn.commit()

# === STATES ===
class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

# === CATEGORIES ===
CATEGORIES = [
    "Nature", "Space", "City", "Superhero", "Supervillain", "Robotic",
    "Anime", "Cars", "Wildlife", "Funny", "Seasonal Greetings",
    "Dark Aesthetic", "Luxury", "Gaming", "Ancient World"
]

# === ADMIN COMMAND ===
@dp.message(Command("admin"))
async def admin_panel(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID:
        return await message.reply("🚫 Access denied.")
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Upload Image", callback_data="upload_image")],
        [InlineKeyboardButton(text="Upload GIF", callback_data="upload_gif")]
    ])
    await message.reply("Welcome Admin! What do you want to upload?", reply_markup=keyboard)

@dp.callback_query(F.data.in_(["upload_image", "upload_gif"]))
async def choose_type(call: CallbackQuery, state: FSMContext):
    await state.update_data(media_type="image" if call.data == "upload_image" else "gif")
    await call.message.edit_text(f"Send me the {'image' if call.data == 'upload_image' else 'GIF'} now.")
    await state.set_state(AdminUpload.waiting_media)

@dp.message(AdminUpload.waiting_media, F.photo | F.animation | F.document)
async def receive_media(message: Message, state: FSMContext):
    data = await state.get_data()
    file_id = message.photo[-1].file_id if message.photo else (message.animation.file_id if message.animation else message.document.file_id)
    file = await bot.get_file(file_id)
    file_path = file.file_path
    file_bytes = await bot.download_file(file_path)

    # Upload to Cloudinary
    resp = cloudinary.uploader.upload(BufferedInputFile(file_bytes.read(), filename="media"),
                                      resource_type="image" if data['media_type'] == "image" else "video",
                                      folder="imagifhub")
    url = resp['secure_url']

    await state.update_data(url=url)
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=cat, callback_data=f"cat_{cat}") for cat in CATEGORIES[i:i+3]] for i in range(0, len(CATEGORIES), 3)
    ])
    await message.reply(f"Media received! Choose category:", reply_markup=keyboard)
    await state.set_state(AdminUpload.waiting_category)

@dp.callback_query(F.data.startswith("cat_"))
async def choose_category(call: CallbackQuery, state: FSMContext):
    category = call.data[4:]
    await state.update_data(category=category)
    await call.message.edit_text(f"Category: {category}\nNow type keywords/subcategories (comma separated):")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def final_step(message: Message, state: FSMContext):
    data = await state.get_data()
    keywords = message.text.strip()

    c.execute("INSERT INTO media (url, type, category, keywords, uploaded_at) VALUES (?, ?, ?, ?, ?)",
              (data['url'], data['media_type'], data['category'], keywords, datetime.now().isoformat()))
    conn.commit()

    await message.reply(f"Successfully uploaded!\nCategory: {data['category']}\nKeywords: {keywords}\n\nPreview:")
    await bot.send_document(message.chat.id, data['url'], caption=f"New drop in #{data['category'].replace(' ', '')}")
    await state.clear()

# === FASTAPI ENDPOINTS (Mini App will call these) ===
@app.get("/media")
async def get_media(category: str = "all", search: str = "", type: str = "all"):
    query = "SELECT * FROM media WHERE 1=1"
    params = []
    if category != "all":
        query += " AND category = ?"
        params.append(category)
    if search:
        query += " AND keywords LIKE ?"
        params.append(f"%{search}%")
    if type != "all":
        query += " AND type = ?"
        params.append(type)
    c.execute(query + " ORDER BY RANDOM() LIMIT 50", params)
    rows = c.fetchall()
    return [{"id": r[0], "url": r[1], "type": r[2], "category": r[3], "likes": r[5]} for r in rows]

@app.post("/like/{media_id}")
async def like(media_id: int, request: Request):
    init_data = request.headers.get("X-Telegram-Init-Data")
    if not init_data: raise HTTPException(403)
    # You can validate init_data here later
    c.execute("UPDATE media SET likes = likes + 1 WHERE id = ?", (media_id,))
    conn.commit()
    return {"success": True}

# === START BOT + API ===
async def on_startup():
    await bot.set_my_commands([types.BotCommand(command="start", description="Start mini app")])
    print("Bot and API running!")

if __name__ == "__main__":
    async def main():
        dp.startup.register(on_startup)
        await dp.start_polling(bot)

    asyncio.run(main())
