import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client

app = FastAPI()

# --- CORS FIX: Allows your frontend to connect ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supabase Setup
supabase: Client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

CATEGORIES = ["Nature", "Space", "City", "Superhero", "Supervillain", "Robotic", "Anime", "Cars", "Wildlife", "Funny", "Seasonal Greetings", "Dark Aesthetic", "Luxury", "Gaming", "Ancient World"]

@app.get("/media")
async def get_media(category: str = "all", search: str = ""):
    query = supabase.table('media_content').select('*')
    if category != "all":
        query = query.eq('category', category.capitalize())
    if search:
        query = query.ilike('Keyword', f'%{search}%')
    
    res = query.order('id', desc=True).limit(50).execute()
    return res.data

@app.post("/like/{media_id}")
async def like(media_id: int):
    # Logic to increment likes in Supabase
    return {"success": True}
    
