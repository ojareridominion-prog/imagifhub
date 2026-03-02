import os
import logging
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client

# Load environment variables
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_ID", 0))
IMGBB_API_KEY = os.environ.get("IMGBB_API_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

# Initialize clients
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Constants
CATEGORIES = [
    "Nature", "Places", "Aesthetic", "Cars",
    "Luxury", "Art", "Animals", "Historical",
    "Anime", "Featured"
]
