from fastapi import APIRouter
import random
from config import supabase

router = APIRouter()

@router.get("/media")
async def get_media(category: str = "all", search: str = "", offset: int = 0, limit: int = 20):
    """
    Fetch media with pagination.
    - offset: starting index
    - limit: number of items to return (default 20)
    - Results are ordered by id (ascending) to support consistent pagination.
    """
    query = supabase.table('media_content').select('*')
    
    if category.lower() not in ["all", "discover"]:
        query = query.eq('category', category)
    if search:
        query = query.ilike('Keyword', f'%{search}%')
    
    # Deterministic order for pagination
    query = query.order('seq_id', desc=False).range(offset, offset + limit - 1)
    
    res = query.execute()
    return res.data
