import os, asyncio, logging, random, requests
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
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

# --- CONFIG ---
BOT_TOKEN = os.environ["BOT_TOKEN"]
ADMIN_ID = int(os.environ["ADMIN_ID"])
IMGBB_API_KEY = os.environ["IMGBB_API_KEY"]
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
dp = Dispatcher(storage=MemoryStorage())
app = FastAPI()

# --- CORS FIX (CRITICAL FOR LOADING IMAGES) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AdminUpload(StatesGroup):
    waiting_media = State()
    waiting_category = State()
    waiting_keywords = State()

CATEGORIES = ["Nature", "Space", "City", "Superhero", "Supervillain", "Robotic", "Anime", "Cars", "Wildlife", "Funny", "Seasonal Greetings", "Dark Aesthetic", "Luxury", "Gaming", "Ancient World"]

# --- AUTO-DELETE LOGIC ---
async def cleanup_links():
    """Removes broken ImgBB links from Supabase automatically."""
    try:
        res = supabase.table('media_content').select('id, url').execute()
        for item in res.data:
            try:
                if requests.head(item['url'], timeout=5).status_code == 404:
                    supabase.table('media_content').delete().eq('id', item['id']).execute()
            except: continue
    except Exception as e: logging.error(f"Cleanup Error: {e}")

# --- ADMIN PANEL ---
@dp.message(Command("admin"))
async def admin_main(message: Message):
    if message.from_user.id != ADMIN_ID: return
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Upload", callback_data="upload")],
        [InlineKeyboardButton(text="🧹 Cleanup Database", callback_data="cleanup")]
    ])
    await message.reply("<b>Admin Panel</b>", reply_markup=kb)

@dp.callback_query(F.data == "upload")
async def start_up(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text("Send me the image(s) now!")
    await state.set_state(AdminUpload.waiting_media)

@dp.message(AdminUpload.waiting_media, F.photo)
async def handle_photo(message: Message, state: FSMContext):
    file = await bot.get_file(message.photo[-1].file_id)
    b = await bot.download_file(file.file_path)
    r = requests.post("https://api.imgbb.com/1/upload", params={'key': IMGBB_API_KEY}, files={'image': b.read()})
    url = r.json()['data']['url']
    
    data = await state.get_data()
    urls = data.get("urls", [])
    urls.append(url)
    await state.update_data(urls=urls)

    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=c, callback_data=f"cat_{c}") for c in CATEGORIES[i:i+3]] for i in range(0, len(CATEGORIES), 3)])
    await message.reply(f"Received! Total: {len(urls)}. Choose Category:", reply_markup=kb)
    await state.set_state(AdminUpload.waiting_category)

@dp.callback_query(F.data.startswith("cat_"))
async def set_cat(call: CallbackQuery, state: FSMContext):
    await state.update_data(category=call.data[4:])
    await call.message.edit_text("Type keywords (comma separated):")
    await state.set_state(AdminUpload.waiting_keywords)

@dp.message(AdminUpload.waiting_keywords)
async def save_all(message: Message, state: FSMContext):
    d = await state.get_data()
    for u in d['urls']:
        supabase.table('media_content').insert({"url": u, "category": d['category'], "Keyword": message.text, "Likes": 0}).execute()
    await message.reply("✅ Saved!")
    await state.clear()

# --- API ENDPOINTS ---
@app.get("/media")
async def get_media(category: str = "all", background_tasks: BackgroundTasks = None):
    if random.random() < 0.2 and background_tasks: background_tasks.add_task(cleanup_links)
    
    query = supabase.table('media_content').select('*')
    if category.lower() != "all": query = query.eq('category', category.capitalize())
    
    res = query.execute().data
    random.shuffle(res) # RANDOMIZATION
    return res[:50]

@app.get("/")
async def h(): return {"status": "Live"}

async def main():
    loop = asyncio.get_event_loop()
    loop.create_task(dp.start_polling(bot))
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))

if __name__ == "__main__":
    asyncio.run(main())
