from fastapi import APIRouter, Request, HTTPException
import logging
from config import supabase, ADMIN_TOKEN

router = APIRouter()

@router.get("/api/admin/stats")
async def admin_stats(request: Request):
    """Admin statistics endpoint"""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    token = auth.replace("Bearer ", "").strip()
    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    try:
        users_res = supabase.table("users").select("count", count="exact").execute()
        total_users = users_res.count or 0
        
        premium_res = supabase.table("users").select("count", count="exact").eq("is_premium", True).execute()
        premium_users = premium_res.count or 0
        
        payments_res = supabase.table("payments").select("amount", "currency").eq("status", "completed").execute()
        total_revenue = sum(p.get("amount", 0) for p in payments_res.data) if payments_res.data else 0
        
        recent_payments = supabase.table("payments").select("*").order("created_at", desc=True).limit(10).execute()
        
        return {
            "total_users": total_users,
            "premium_users": premium_users,
            "premium_percentage": (premium_users / total_users * 100) if total_users > 0 else 0,
            "total_revenue": total_revenue,
            "recent_payments": recent_payments.data if recent_payments.data else []
        }
        
    except Exception as e:
        logging.error(f"Admin stats error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
