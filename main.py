import os
import asyncio
import logging
import requests
from fastapi import FastAPI, Request
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.default import DefaultBotProperties

# NEW IMPORTS FOR SUPABASE
from supabase import create_client, Client
import uvicorn

logging.basicConfig(level=logging.INFO)

# ==================== CONFIG ====================
BOT_TOKEN = os.environ["BOT_TOKEN"]
ADMIN_ID = int(os.environ["ADMIN_ID"])
IMGBB_API_KEY = os.environ["IMGBB_API_KEY"]

# === NEW: SUPABASE CONFIG ===
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    logging.error("SUPABASE_URL or SUPABASE_KEY not set in environment.")
    # In a production environment, you might stop the app here.

# Initialize Supabase Client
try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    logging.info("Supabase client initialized.")
except Exception as e:
     logging.error(f"Failed to initialize Supabase client: {e}")
     # Proceed with partial functionality if initialization is non-fatal

# ==================== DATABASE REMOVAL ====================
# Removed: import sqlite3
# Removed: conn = sqlite3.connect(...)
# Removed: c.execute(...)

bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
storage = MemoryStorage()
dp = Dispatcher(storage=storage)
app = FastAPI()

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
                continue
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
        
        insert_count = 0
        
        # === NEW: INSERT INTO SUPABASE (FIXED LOGIC) ===
        for url in urls:
            # 1. Prepare the data payload, using the column names from your Supabase table
            payload = {
                "url": url,
                "category": data['category'],
                "Keyword": keywords, # Maps to the "Keyword" column in Supabase
                "Likes": 0,           # Maps to the "Likes" column in Supabase
                # 'Uploaded' is set automatically by the 'now()' default
            }
            
            # 2. Execute the insertion
            response = supabase.table('media_content').insert(payload).execute()
            
            # 3. Check for successful insertion (fixes the 'tuple' and 'int' error)
            # The inserted row data is in the .data property if successful
            if response.data and len(response.data) > 0:
                insert_count += 1
            else:
                logging.error(f"Supabase insertion failed for URL: {url}. Response: {response.json()}")

        # 4. Final Bot Reply
        if insert_count > 0:
            await message.reply(f"✅ Successfully uploaded {insert_count} image(s) to Supabase!\nCategory: {data['category']}\nKeywords: {keywords}")
        else:
             await message.reply("❌ Error: ImgBB upload succeeded, but no data was saved to Supabase.")

        await state.clear()
        
    except Exception as e:
        # This catches errors during ImgBB upload or other unexpected Supabase errors
        logging.error(f"Save error: {e}")
        # The Supabase response often contains details in the error object:
        await message.reply(f"❌ Save failed — try again. Error: {e}")

# ==================== API ENDPOINTS ====================
@app.get("/media")
async def get_media(category: str = "all", search: str = ""): # Removed 'type' as you only have images now
    # === NEW: FETCH FROM SUPABASE ===
    # Select the columns, mapping 'Keyword' and 'Likes' to expected keys for frontend
    query = supabase.table('media_content').select('id, url, category, "Keyword", "Likes"')
    
    if category != "all":
        query = query.eq('category', category)
        
    if search:
        # Supabase uses 'like' for basic pattern matching
        query = query.like('Keyword', f'%{search}%')
        
    # Order by ID descending (most recent first) and limit results
    try:
        response = query.order('id', desc=True).limit(50).execute()
        
        # Format the results for the frontend
        rows = response.data
        return [{"id": r['id'], "url": r['url'], "type": "image", "category": r['category'], "keywords": r['Keyword'], "likes": r['Likes']} for r in rows]

    except Exception as e:
        logging.error(f"Supabase GET /media error: {e}")
        return {"error": "Could not fetch media content from database."}, 500

@app.post("/like/{media_id}")
async def like(media_id: int):
    # === NEW: UPDATE LIKES IN SUPABASE ===
    try:
        # We can use the fetch-then-update pattern for a simple increment
        
        # 1. Fetch current likes
        # Note: If the ID column is UUID (as previously discussed), media_id should be string
        # Assuming ID is convertible to integer/serial type for now based on previous code.
        current_data = supabase.table('media_content').select('Likes').eq('id', media_id).single().execute()
        current_likes = current_data.data['Likes'] if current_data.data else 0
        new_likes = current_likes + 1
        
        # 2. Update the Likes column
        response = supabase.table('media_content').update({
            "Likes": new_likes
        }).eq('id', media_id).execute()
        
        # Check if update was successful (response.count is more reliable here)
        if response.count and response.count > 0:
             # Return the new like count for the Mini App to update
             return {"success": True, "new_likes": new_likes}
        else:
             return {"success": False, "message": "Media ID not found or update failed."}, 404
             
    except Exception as e:
        logging.error(f"Supabase POST /like error: {e}")
        return {"success": False, "message": "Database update failed."}, 500

@app.get("/")
async def health():
    return {"status": "IMAGIFHUB Live - Images Only (Supabase Connected)"}

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
