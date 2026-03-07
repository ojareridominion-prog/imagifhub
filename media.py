from fastapi import APIRouter
import random
from config import supabase

router = APIRouter()

@router.get("/media")
async def get_media(category: str = "all", search: str = ""):
    query = supabase.table('media_content').select('*')
    if category.lower() not in ["all", "discover"]:
        # Use raw category string to preserve exact case (e.g., "Ai-generated")
        query = query.eq('category', category)
    if search:
        query = query.ilike('Keyword', f'%{search}%')
    res = query.execute()
    data = res.data
    random.shuffle(data)
    return data[:50]
