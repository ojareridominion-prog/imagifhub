import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware # <--- THE FIX
from supabase import create_client, Client

app = FastAPI()

# === CORS FIX: This allows your frontend to talk to your backend ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allows any site to connect (perfect for Mini Apps)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connect to Supabase
supabase: Client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

# FULL CATEGORY LIST (Synced with Python code)
CATEGORIES = [
    "Nature", "Space", "City", "Superhero", "Supervillain", "Robotic", 
    "Anime", "Cars", "Wildlife", "Funny", "Seasonal Greetings", 
    "Dark Aesthetic", "Luxury", "Gaming", "Ancient World"
]

@app.get("/media")
async def get_media(category: str = "all", search: str = ""):
    query = supabase.table('media_content').select('*')
    if category != "all":
        query = query.eq('category', category.capitalize())
    if search:
        query = query.ilike('Keyword', f'%{search}%')
    
    res = query.order('id', desc=True).limit(50).execute()
    return res.data

@app.get("/")
async def health():
    return {"status": "IMAGIFHUB API Live"}
    
