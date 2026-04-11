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

# media.py – replace the existing /media/random endpoint

@router.get("/media/random")
async def get_random_media(limit: int = 30, category: str = None, search: str = None):
    """
    Fetch random images, optionally filtered by category or search keyword.
    - category "Discover" or None/empty → all images
    - other categories → filter by that category
    - search → filter by Keyword (case-insensitive partial match)
    """
    try:
        # Build base query
        query = supabase.table('media_content').select('*', count='exact')
        
        # Apply category filter if provided and not "Discover"
        if category and category.lower() != "discover":
            query = query.eq('category', category)
        
        # Apply search filter if provided
        if search and search.strip():
            query = query.ilike('Keyword', f'%{search.strip()}%')
        
        # Get total count of filtered results
        count_res = query.execute()
        total_count = count_res.count
        if not total_count or total_count == 0:
            return []
        
        # If total is less than limit, return all
        if total_count <= limit:
            res = query.limit(limit).execute()
            return res.data
        
        # Pick a random starting offset
        max_offset = total_count - limit
        random_offset = random.randint(0, max_offset)
        
        # Fetch paginated results (ordered by id for consistency)
        res = query.order('id', desc=False) \
                  .range(random_offset, random_offset + limit - 1) \
                  .execute()
        
        return res.data
    except Exception as e:
        print(f"Error in /media/random: {e}")
        return []
        
