import os
import asyncio
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware # <--- CORS FIX
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from supabase import create_client, Client
import uvicorn

logging.basicConfig(level=logging.INFO)

# --- CONFIG ---
BOT_TOKEN = os.environ["BOT_TOKEN"]
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
dp = Dispatcher()
app = FastAPI()

# === FIX: ALLOW FRONTEND CONNECTION (CORS) ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allows any frontend to connect
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- CATEGORIES (Full List synced with frontend) ---
CATEGORIES = [
    "Nature", "Space", "City", "Superhero", "Supervillain", "Robotic",
    "Anime", "Cars", "Wildlife", "Funny", "Seasonal Greetings",
    "Dark Aesthetic", "Luxury", "Gaming", "Ancient World"
]

@app.get("/media")
async def get_media(category: str = "all", search: str = ""):
    query = supabase.table('media_content').select('id, url, category, "Keyword", "Likes"')
    if category != "all":
        query = query.eq('category', category.capitalize() if category != "all" else "All")
    if search:
        query = query.ilike('Keyword', f'%{search}%')
    
    response = query.order('id', desc=True).limit(50).execute()
    return [{"id": r['id'], "url": r['url'], "category": r['category'], "keywords": r['Keyword'], "likes": r['Likes']} for r in response.data]

@app.post("/like/{media_id}")
async def like(media_id: str):
    # Simplified like logic for brevity
    return {"success": True}

@app.get("/")
async def health():
    return {"status": "IMAGIFHUB API Live"}

# (Keep your run_bot and main() functions here)

