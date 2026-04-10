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

@router.get("/media/random")
async def get_random_media(limit: int = 30):
    """
    Fetch random images using random offset (more reliable than order('random()')).
    """
    try:
        # First, get total count of images
        count_res = supabase.table('media_content').select('id', count='exact').execute()
        total_count = count_res.count
        if not total_count or total_count == 0:
            return []
        
        # If total_count is less than limit, just return all
        if total_count <= limit:
            res = supabase.table('media_content').select('*').limit(limit).execute()
            return res.data
        
        # Pick a random starting offset
        import random
        max_offset = total_count - limit
        random_offset = random.randint(0, max_offset)
        
        # Use deterministic order (by id) for consistent pagination
        res = supabase.table('media_content') \
            .select('*') \
            .order('id', desc=False) \
            .range(random_offset, random_offset + limit - 1) \
            .execute()
        
        return res.data
    except Exception as e:
        # Log error on server side
        print(f"Error in /media/random: {e}")
        # Return empty list instead of crashing
        return []
        
    
