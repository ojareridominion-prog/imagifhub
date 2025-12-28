import os
import logging
import random
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client

# Always space your work.

logging.basicConfig(level=logging.INFO)

# ==================== CONFIG ====================

BOT_TOKEN = os.environ.get("BOT_TOKEN")
# We initialize these as None or get them from env to prevent startup crashes if missing
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

# Initialize Supabase
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Initialize Telegram (Required for internal logic, even if polling is off)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())

# Initialize FastAPI
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== API ENDPOINTS ====================

@app.get("/api/media")
async def get_media(category: str = "all", search: str = ""):
    """
    This is the main endpoint your frontend (script.js) calls.
    It fetches image URLs from your Supabase database.
    """
    try:
        query = supabase.table('media_content').select('*')
        
        # "Featured" and "all" act as a global feed
        if category.lower() not in ["all", "featured"]:
            # Format category (e.g., "Cars" or "Nature")
            formatted_cat = category.replace("-", " ").title()
            query = query.eq('category', formatted_cat)
        
        if search:
            query = query.ilike('Keyword', f'%{search}%')
            
        response = query.execute()
        data = response.data
        
        # Randomize order for the "TikTok-style" vertical scroll feel
        random.shuffle(data)
        
        # Return the top 50 results
        return data[:50]
        
    except Exception as e:
        logging.error(f"Database error: {e}")
        return {"error": str(e)}

@app.get("/api/health")
async def health(): 
    return {"status": "Live", "message": "ImagifHub API is running"}

# ==================== VERCEL NOTES ====================
# 1. DO NOT add app.run() or uvicorn.run() here. 
# 2. DO NOT add dp.start_polling(bot). 
# Vercel handles the execution of the 'app' instance automatically.
