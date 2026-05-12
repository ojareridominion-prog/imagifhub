import os
import logging
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client

# Load environment variables
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_IDS_RAW = os.environ.get("ADMIN_ID", "")
# Parse comma-separated admin IDs, e.g., "6403924487,1234567890"
ADMIN_IDS = [int(x.strip()) for x in ADMIN_IDS_RAW.split(",") if x.strip().isdigit()]
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
    "Ai-generated", "Featured"
]

# Keep a single integer for backward compatibility with any code that still expects ADMIN_ID
if ADMIN_IDS:
    ADMIN_ID = ADMIN_IDS[0]  # first admin as the "primary"
else:
    ADMIN_ID = 0
    
