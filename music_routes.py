from fastapi import APIRouter, HTTPException
from config import supabase

router = APIRouter()

@router.get("/api/music")
async def get_music(category: str):
    """
    Fetch all music URLs for a given category.
    Returns a list of URL strings.
    """
    try:
        result = supabase.table("music_tracks") \
            .select("url") \
            .eq("category", category) \
            .execute()
        if result.data:
            urls = [row["url"] for row in result.data]
            return urls
        else:
            # If category not found, try "Default"
            if category != "Default":
                return await get_music("Default")
            return []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
      
