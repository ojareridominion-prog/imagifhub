import os
import asyncio
import logging
import random
import requests
from fastapi import FastAPI, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client
import uvicorn

# Always space your work.

logging.basicConfig(level=logging.INFO)

# ==================== CONFIG ====================

[span_0](start_span)BOT_TOKEN = os.environ["BOT_TOKEN"][span_0](end_span)
[span_1](start_span)ADMIN_ID = int(os.environ["ADMIN_ID"])[span_1](end_span)
[span_2](start_span)IMGBB_API_KEY = os.environ["IMGBB_API_KEY"][span_2](end_span)
[span_3](start_span)SUPABASE_URL = os.environ.get("SUPABASE_URL")[span_3](end_span)
[span_4](start_span)SUPABASE_KEY = os.environ.get("SUPABASE_KEY")[span_4](end_span)

[span_5](start_span)supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)[span_5](end_span)
[span_6](start_span)bot = Bot(token=BOT_TOKEN)[span_6](end_span)
[span_7](start_span)dp = Dispatcher(storage=MemoryStorage())[span_7](end_span)
[span_8](start_span)app = FastAPI()[span_8](end_span)

# Enhanced CORS to ensure frontend requests aren't blocked
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
[span_9](start_span))

class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()[span_9](end_span)

CATEGORIES = [
    "Nature", "Space", "City", "Superhero", "Supervillain", 
    "Robotic", "Anime", "Cars", "Wildlife", "Funny", 
    "Seasonal Greetings", "Dark Aesthetic", "Luxury", "Gaming", "Ancient World"
[span_10](start_span)]

# ==================== BOT ADMIN LOGIC ====================

@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID: 
        return[span_10](end_span)
        
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload Media", callback_data="up")]
    [span_11](start_span)])[span_11](end_span)
    
    [span_12](start_span)await message.reply("<b>IMAGIFHUB ADMIN</b>", reply_markup=keyboard, parse_mode="HTML")[span_12](end_span)


@dp.callback_query(F.data == "up")
async def start_upload(call: CallbackQuery, state: FSMContext):
    [span_13](start_span)await call.message.edit_text("Please send the image(s) you want to upload.")[span_13](end_span)
    [span_14](start_span)await state.set_state(AdminUpload.waiting_media)[span_14](end_span)


@dp.message(AdminUpload.waiting_media, F.photo)
async def handle_media(message: Message, state: FSMContext):
    [span_15](start_span)file = await bot.get_file(message.photo[-1].file_id)[span_15](end_span)
    [span_16](start_span)file_bytes = await bot.download_file(file.file_path)[span_16](end_span)
    
    resp = requests.post(
        "https://api.imgbb.com/1/upload", 
        params={'key': IMGBB_API_KEY}, 
        files={'image': file_bytes.read()}
    [span_17](start_span))
    
    url = resp.json()['data']['url'][span_17](end_span)
    
    [span_18](start_span)data = await state.get_data()[span_18](end_span)
    [span_19](start_span)urls = data.get("urls", [])[span_19](end_span)
    [span_20](start_span)urls.append(url)[span_20](end_span)
    [span_21](start_span)await state.update_data(urls=urls)[span_21](end_span)
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=cat, callback_data=f"cat_{cat}") for cat in CATEGORIES[i:i+3]]
        for i in range(0, len(CATEGORIES), 3)
    [span_22](start_span)])[span_22](end_span)
    
    [span_23](start_span)await message.reply(f"Received {len(urls)} image(s). Pick a category:", reply_markup=keyboard)[span_23](end_span)
    [span_24](start_span)await state.set_state(AdminUpload.waiting_category)[span_24](end_span)


@dp.callback_query(F.data.startswith("cat_"))
async def set_category(call: CallbackQuery, state: FSMContext):
    [span_25](start_span)await state.update_data(category=call.data[4:])[span_25](end_span)
    [span_26](start_span)await call.message.edit_text("Enter Keywords (separated by commas):")[span_26](end_span)
    [span_27](start_span)await state.set_state(AdminUpload.waiting_keywords)[span_27](end_span)


@dp.message(AdminUpload.waiting_keywords)
async def save_to_supabase(message: Message, state: FSMContext):
    [span_28](start_span)user_data = await state.get_data()[span_28](end_span)
    
    for url in user_data['urls']:
        supabase.table('media_content').insert({
            "url": url, 
            "category": user_data['category'], 
            "Keyword": message.text
        [span_29](start_span)}).execute()[span_29](end_span)
        
    [span_30](start_span)await message.reply("✅ All media saved to database!")[span_30](end_span)
    [span_31](start_span)await state.clear()[span_31](end_span)

# ==================== API ENDPOINTS ====================

@app.get("/media")
async def get_media(category: str = "all", search: str = ""):
    [span_32](start_span)query = supabase.table('media_content').select('*')[span_32](end_span)
    
    if category.lower() != "all":
        [span_33](start_span)formatted_cat = category.replace("-", " ").title()[span_33](end_span)
        [span_34](start_span)query = query.eq('category', formatted_cat)[span_34](end_span)
    
    if search:
        [span_35](start_span)query = query.ilike('Keyword', f'%{search}%')[span_35](end_span)
        
    [span_36](start_span)response = query.execute()[span_36](end_span)
    [span_37](start_span)data = response.data[span_37](end_span)
    [span_38](start_span)random.shuffle(data)[span_38](end_span)
    [span_39](start_span)return data[:50][span_39](end_span)


@app.post("/like/{media_id}")
async def like_media(media_id: int, payload: dict = Body(...)):
    [span_40](start_span)user_id = payload.get('user_id')[span_40](end_span)
    if not user_id:
        [span_41](start_span)raise HTTPException(status_code=400, detail="User ID required")[span_41](end_span)
        
    try:
        supabase.table('likes').upsert({
            "user_id": int(user_id),
            "media_id": int(media_id)
        [span_42](start_span)}).execute()[span_42](end_span)
        
        [span_43](start_span)count_res = supabase.table('likes').select('id', count='exact').eq('media_id', media_id).execute()[span_43](end_span)
        
        [span_44](start_span)return {"status": "success", "new_likes": count_res.count}[span_44](end_span)
    except Exception as e:
        [span_45](start_span)return {"status": "error", "message": str(e)}[span_45](end_span)


@app.post("/playlist/add")
async def add_to_playlist(payload: dict = Body(...)):
    try:
        user_id = payload.get('user_id')
        media_id = payload.get('media_id')
        
        if not user_id or not media_id:
            raise HTTPException(status_code=400, detail="User ID and Media ID required")

        supabase.table('user_playlists').upsert({
            "user_id": int(user_id),
            "media_id": int(media_id)
        [span_46](start_span)}).execute()[span_46](end_span)
        
        [span_47](start_span)return {"status": "added"}[span_47](end_span)
    except Exception as e:
        logging.error(f"Error adding to playlist: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/playlist/{user_id}")
async def get_playlist(user_id: int):
    [span_48](start_span)res = supabase.table('user_playlists').select('media_id').eq('user_id', user_id).execute()[span_48](end_span)
    [span_49](start_span)ids = [x['media_id'] for x in res.data][span_49](end_span)
    
    if not ids: 
        [span_50](start_span)return [][span_50](end_span)
        
    [span_51](start_span)media_res = supabase.table('media_content').select('*').in_('id', ids).execute()[span_51](end_span)
    [span_52](start_span)return media_res.data[span_52](end_span)


@app.delete("/playlist/remove/{user_id}/{media_id}")
async def remove_item(user_id: int, media_id: int):
    [span_53](start_span)supabase.table('user_playlists').delete().eq('user_id', user_id).eq('media_id', media_id).execute()[span_53](end_span)
    [span_54](start_span)return {"status": "removed"}[span_54](end_span)


@app.get("/")
async def health(): 
    [span_55](start_span)return {"status": "Live"}[span_55](end_span)

# ==================== RUN ====================

async def main():
    # Start Telegram Bot in background
    [span_56](start_span)asyncio.create_task(dp.start_polling(bot))[span_56](end_span)
    
    # Start FastAPI Server
    [span_57](start_span)port = int(os.environ.get("PORT", 10000))[span_57](end_span)
    [span_58](start_span)config = uvicorn.Config(app, host="0.0.0.0", port=port)[span_58](end_span)
    [span_59](start_span)server = uvicorn.Server(config)[span_59](end_span)
    [span_60](start_span)await server.serve()[span_60](end_span)


if __name__ == "__main__":
    [span_61](start_span)asyncio.run(main())[span_61](end_span)
