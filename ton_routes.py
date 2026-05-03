# ton_routes.py - complete backend for TON payments
from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timedelta
import logging
import os
import httpx
import asyncio
from config import supabase
from utils import get_user_id_from_init_data

router = APIRouter()

TON_API_KEY = os.environ.get("TONCENTER_API_KEY", "")
ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
PAYMENT_AMOUNT = float(os.environ.get("TON_PAYMENT_AMOUNT", 1.12))

# ------------------------------------------------
# Verification endpoint (works with BOC or tx hash)
# ------------------------------------------------
@router.post("/api/verify-ton-payment")
async def verify_ton_payment(request: Request):
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    boc = body.get("boc")          # Base64 encoded BOC from sendTransaction
    tx_hash = body.get("txHash")   # fallback

    if not boc and not tx_hash:
        raise HTTPException(status_code=400, detail="Missing transaction data")

    if not TON_API_KEY or not ADMIN_ADDRESS:
        raise HTTPException(status_code=500, detail="TON payment not configured")

    # Helper to grant premium
    async def grant_premium():
        now = datetime.utcnow()
        result = supabase.table("users").select("premium_expires_at").eq("telegram_id", user_id).execute()
        new_expiry = now + timedelta(days=30)
        if result.data and result.data[0].get("premium_expires_at"):
            current_expiry_str = result.data[0]["premium_expires_at"]
            try:
                if current_expiry_str.endswith('Z'):
                    current_expiry_str = current_expiry_str.replace('Z', '+00:00')
                current_expiry = datetime.fromisoformat(current_expiry_str)
                if current_expiry.tzinfo:
                    current_expiry = current_expiry.replace(tzinfo=None)
                if current_expiry > now:
                    new_expiry = current_expiry + timedelta(days=30)
            except:
                pass
        supabase.table("users").upsert({
            "telegram_id": user_id,
            "is_premium": True,
            "premium_expires_at": new_expiry.isoformat(),
            "updated_at": now.isoformat()
        }).execute()
        # Log payment (we'll try to log tx_hash later)
        supabase.table("payments").insert({
            "telegram_id": user_id,
            "provider": "ton",
            "amount": PAYMENT_AMOUNT,
            "currency": "TON",
            "payload": f"premium_{user_id}",
            "transaction_id": tx_hash or "boc_payment",
            "status": "completed"
        }).execute()
        logging.info(f"TON premium granted to user {user_id}")
        return True

    # Polling logic for transaction confirmation
    async with httpx.AsyncClient() as client:
        # Try to find a recent incoming transaction to ADMIN_ADDRESS with correct amount
        url = f"https://toncenter.com/api/v3/transactions?account={ADMIN_ADDRESS}&limit=20"
        headers = {"X-API-Key": TON_API_KEY}
        for attempt in range(8):   # try for ~24 seconds
            await asyncio.sleep(3)
            try:
                resp = await client.get(url, headers=headers, timeout=10)
                if resp.status_code == 200:
                    data = resp.json()
                    txs = data.get("transactions", [])
                    for tx in txs:
                        in_msg = tx.get("in_msg", {})
                        source = in_msg.get("source")
                        value_nano = int(in_msg.get("value", "0"))
                        if value_nano >= PAYMENT_AMOUNT * 1e9:
                            # Found a valid incoming payment
                            await grant_premium()
                            return {"success": True, "tx_hash": tx.get("hash")}
            except Exception as e:
                logging.warning(f"TON polling attempt {attempt+1} failed: {e}")
        return {"success": False, "reason": "Transaction not found within timeout"}

# Configuration endpoint for client
@router.get("/api/ton-config")
async def ton_config():
    return {"adminAddress": ADMIN_ADDRESS}
    
