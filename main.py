import os
import requests
import logging
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from supabase import create_client, Client

# --- SETUP ---
BOT_TOKEN = os.environ["BOT_TOKEN"]
ADMIN_ID = int(os.environ["ADMIN_ID"])
IMGBB_API_KEY = os.environ["IMGBB_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"] # Use Service Role Key if possible

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
dp = Dispatcher()

class AdminStates(StatesGroup):
    waiting_photo = State()
    waiting_details = State()

CATEGORIES = ["Nature", "Anime", "Cars", "Luxury"] # Simplified for testing

# --- 1. THE ADMIN PANEL INTERFACE ---
@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID: return
    
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload New", callback_data="admin_up")],
        [InlineKeyboardButton(text="🧹 Clean Broken Links", callback_data="admin_clean")]
    ])
    await message.reply("<b>Admin Controls Only</b>", reply_markup=kb)

# --- 2. UPLOAD LOGIC ---
@dp.callback_query(F.data == "admin_up")
async def start_up(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Send the image now.")
    await state.set_state(AdminStates.waiting_photo)

@dp.message(AdminStates.waiting_photo, F.photo)
async def process_photo(message: Message, state: FSMContext):
    # Get file from Telegram
    file = await message.bot.get_file(message.photo[-1].file_id)
    file_content = await message.bot.download_file(file.file_path)
    
    # Upload to ImgBB
    res = requests.post(
        "https://api.imgbb.com/1/upload", 
        params={'key': IMGBB_API_KEY}, 
        files={'image': file_content.read()}
    )
    img_url = res.json()['data']['url']
    
    # Save to Supabase immediately
    # We use a default category 'General' and 'Wallpaper' keyword for testing
    payload = {
        "url": img_url,
        "category": "General",
        "Keyword": "New Upload",
        "Likes": 0
    }
    
    db_res = supabase.table('media_content').insert(payload).execute()
    
    if db_res.data:
        await message.reply(f"✅ Success!\nURL: {img_url}")
    else:
        await message.reply("❌ Supabase Rejected the Data. Check RLS settings.")
    await state.clear()

# --- 3. CLEANUP LOGIC ---
@dp.callback_query(F.data == "admin_clean")
async def run_cleanup(call: CallbackQuery):
    await call.answer("Cleaning...")
    
    # Fetch all records
    records = supabase.table('media_content').select('id, url').execute().data
    deleted = 0
    
    for item in records:
        try:
            # Check if ImgBB link is dead
            check = requests.head(item['url'], timeout=5)
            if check.status_code == 404:
                supabase.table('media_content').delete().eq('id', item['id']).execute()
                deleted += 1
        except: continue
        
    await call.message.answer(f"🧹 Cleanup Finished. Removed {deleted} broken links.")
    
