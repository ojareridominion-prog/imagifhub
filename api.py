import os
import logging
import asyncio
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot
from supabase import create_client, Client
from aiogram.types import LabeledPrice

# ==================== CONFIG ====================
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

# Initialize Clients
api_app = FastAPI()
bot = Bot(token=BOT_TOKEN)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

api_app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"], 
    allow_methods=["*"], 
    allow_headers=["*"]
)

# ==================== PAYMENT API ====================

@api_app.get("/api/get-payment-link")
async def get_payment_link(user_id: int):
    """Simple endpoint for mini app to get payment link"""
    try:
        invoice_link = await bot.create_invoice_link(
            title="IMAGIFHUB Premium",
            description="30 days of ad-free experience",
            payload=f"premium_{user_id}",
            provider_token="",
            currency="XTR",
            prices=[LabeledPrice(label="Premium Access", amount=149)]
        )
        return {
            "success": True,
            "invoice_url": invoice_link,
            "user_id": user_id
        }
    except Exception as e:
        logging.error(f"Payment link error: {e}")
        return {"success": False, "error": str(e)}

@api_app.post("/api/create-invoice")
async def create_invoice(request: Request):
    try:
        data = await request.json()
        user_id = data.get("user_id")
        
        if not user_id:
            raise HTTPException(status_code=400, detail="User ID required")
        
        invoice_link = await bot.create_invoice_link(
            title="IMAGIFHUB Premium",
            description="30 days of ad-free experience",
            payload=f"premium_{user_id}",
            provider_token="",
            currency="XTR",
            prices=[LabeledPrice(label="Premium Access", amount=149)]
        )
        
        return {"invoice_url": invoice_link}
        
    except Exception as e:
        logging.error(f"Create invoice error: {e}")
        return {"error": str(e), "status": "failed"}

@api_app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "imagifhub-api"}
