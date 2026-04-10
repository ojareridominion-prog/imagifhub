# premium_expiry_checker.py
import asyncio
import logging
from datetime import datetime
from config import supabase

logger = logging.getLogger(__name__)

async def update_expired_premiums():
    """Set is_premium = false for users whose premium_expires_at < now()."""
    try:
        now_iso = datetime.utcnow().isoformat()
        result = supabase.table("users") \
            .update({
                "is_premium": False,
                "premium_expires_at": None
            }) \
            .eq("is_premium", True) \
            .lt("premium_expires_at", now_iso) \
            .execute()
        updated_count = len(result.data) if result.data else 0
        if updated_count:
            logger.info(f"✅ Updated {updated_count} expired premium users")
        return updated_count
    except Exception as e:
        logger.error(f"Failed to update expired premiums: {e}")
        return 0

async def run_expiry_checker(interval_hours: int = 6):
    """Run the expiry updater every `interval_hours`."""
    while True:
        await update_expired_premiums()
        await asyncio.sleep(interval_hours * 3600)
