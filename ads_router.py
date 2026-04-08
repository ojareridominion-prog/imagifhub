import json
import random
from fastapi import APIRouter, HTTPException
import logging

router = APIRouter()

ADS_FILE = "ads.json"

def load_ads():
    try:
        with open(ADS_FILE, "r", encoding="utf-8") as f:
            ads = json.load(f)
            # Ensure each ad has an 'action' field (URL)
            for ad in ads:
                if "action" not in ad:
                    ad["action"] = "#"
            return ads
    except Exception as e:
        logging.error(f"Failed to load ads.json: {e}")
        return []

@router.get("/api/ads")
async def get_ads():
    """Return all ads (used by mini app)."""
    ads = load_ads()
    return ads

@router.get("/api/random-ad")
async def get_random_ad():
    """Return one random ad (used by bot chat)."""
    ads = load_ads()
    if not ads:
        raise HTTPException(status_code=404, detail="No ads available")
    return random.choice(ads)
  
