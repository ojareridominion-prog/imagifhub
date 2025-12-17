import os
import asyncio
import logging
import requests
from fastapi import FastAPI
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

# --- CONFIG ---
BOT_TOKEN = os.environ["BOT_TOKEN"]
ADMIN_ID = int(os.environ["ADMIN_ID"])
IMGBB_API_KEY = os.environ["IMGBB_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

# Initialize Clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())
app = FastAPI()

# Enable CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class AdminStates(StatesGroup):
    waiting_photo = State()

# --- ADMIN PANEL ---
@dp.message(Command("admin"))
async def admin_start(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload Image", callback_data="do_up")],
        [InlineKeyboardButton(text="🧹 Cleanup Database", callback_data="do_clean")]
    ])
    await message.reply("<b>ADMIN PANEL ACTIVE</b>", reply_markup=kb, parse_mode="HTML")

# --- CLEANUP LOGIC ---
@dp.callback_query(F.data == "do_clean")
async def cleanup_process(call: CallbackQuery):
    await call.answer("Scanning database...")
    try:
        res = supabase.table('media_content').select('id, url').execute()
        deleted = 0
        for item in res.data:
            try:
                # Check if image actually exists on ImgBB
                check = requests.head(item['url'], timeout=5)
                if check.status_code == 404:
                    supabase.table('media_content').delete().eq('id', item['id']).execute()
                    deleted += 1
            except: continue
        await call.message.answer(f"✅ Cleanup complete. Removed {deleted} broken links.")
    except Exception as e:
        await call.message.answer(f"❌ Database error: {str(e)}")

# --- UPLOAD LOGIC ---
@dp.callback_query(F.data == "do_up")
async def ask_photo(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Send the image you want to upload.")
    await state.set_state(AdminStates.waiting_photo)

@dp.message(AdminStates.waiting_photo, F.photo)
async def handle_upload(message: Message, state: FSMContext):
    msg = await message.reply("⏳ Processing...")
    try:
        # 1. Download from Telegram
        file = await bot.get_file(message.photo[-1].file_id)
        content = await bot.download_file(file.file_path)
        
        # 2. Upload to ImgBB
        up_res = requests.post(
            "https://api.imgbb.com/1/upload",
            params={'key': IMGBB_API_KEY},
            files={'image': content.read()}
        )
        url = up_res.json()['data']['url']
        
        # 3. Save to Supabase (Simple Insert)
        payload = {
            "url": url,
            "category": "All",
            "Keyword": "New Post",
            "Likes": 0
        }
        db_res = supabase.table('media_content').insert(payload).execute()
        
        if db_res.data:
            await msg.edit_text(f"✅ Uploaded Successfully!\nURL: {url}")
        else:
            await msg.edit_text("❌ Database rejected upload. Check Supabase RLS.")
            
    except Exception as e:
        await msg.edit_text(f"❌ Critical Error: {str(e)}")
    
    await state.clear()

# --- API ---
@app.get("/media")
async def get_media():
    res = supabase.table('media_content').select('*').execute()
    return res.data

# --- RUNNER ---
async def start():
    # Start bot and server
    asyncio.create_task(dp.start_polling(bot))
    config = uvicorn.Config(app, host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))
    server = uvicorn.Server(config)
    await server.serve()

if __name__ == "__main__":
    asyncio.run(start())
