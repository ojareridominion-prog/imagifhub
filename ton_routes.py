# ton_routes.py - Direct blockchain polling (no webhooks, no payload required)
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from datetime import datetime, timedelta
import logging
import os
import hashlib
import json
import aiohttp
from config import supabase
from utils import get_user_id_from_init_data

router = APIRouter()

TON_API_KEY = os.environ.get("TONCENTER_API_KEY", "")
ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
PAYMENT_AMOUNT = float(os.environ.get("TON_PAYMENT_AMOUNT", 1.12))

async def grant_premium(user_id: int, tx_hash: str = None, amount: float = PAYMENT_AMOUNT):
    """Grant premium access to a user (30 days, stacking with existing)"""
    now = datetime.utcnow()
    result = supabase.table("users").select("premium_expires_at").eq("telegram_id", user_id).execute()
    new_expiry = now + timedelta(days=30)
    
    if result.data and result.data[0].get("premium_expires_at"):
        try:
            current_expiry_str = result.data[0]["premium_expires_at"]
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
    
    supabase.table("payments").insert({
        "telegram_id": user_id,
        "provider": "ton",
        "amount": amount,
        "currency": "TON",
        "payload": f"premium_{user_id}",
        "transaction_id": tx_hash or f"polling_{user_id}",
        "status": "completed"
    }).execute()
    
    logging.info(f"TON premium granted to user {user_id} until {new_expiry.isoformat()}")
    return True

async def check_transaction_on_chain(tx_hash: str, expected_user_id: int) -> bool:
    """
    Verify that a valid transaction exists on the TON blockchain:
    - Sent to ADMIN_ADDRESS
    - Amount >= PAYMENT_AMOUNT
    (No comment/payload verification – the user is identified by the polling request)
    Returns True if valid and premium granted.
    """
    if not TON_API_KEY or not ADMIN_ADDRESS:
        logging.error("Missing TON API key or admin address")
        return False

    url = f"https://toncenter.com/api/v2/getTransactions"
    params = {
        "address": ADMIN_ADDRESS,
        "hash": tx_hash,
        "limit": 1,
        "api_key": TON_API_KEY
    }
    
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(url, params=params, timeout=10) as resp:
                if resp.status != 200:
                    logging.warning(f"TON API returned {resp.status}: {await resp.text()}")
                    return False
                data = await resp.json()
                
                if not data.get("ok") or not data.get("result"):
                    logging.info(f"Transaction {tx_hash} not found yet")
                    return False
                
                transaction = data["result"][0]
                
                # Check destination address (in_message)
                in_msg = transaction.get("in_msg", {})
                destination = in_msg.get("destination", "") or in_msg.get("dest", "")
                if destination.lower() != ADMIN_ADDRESS.lower():
                    logging.warning(f"Wrong destination: {destination}")
                    return False
                
                # Check amount (in nanoTON)
                amount_nano = int(in_msg.get("value", "0"))
                expected_nano = int(PAYMENT_AMOUNT * 1e9)
                if amount_nano < expected_nano:
                    logging.warning(f"Insufficient amount: {amount_nano} nano < {expected_nano}")
                    return False
                
                # No comment/payload validation needed – we trust the caller's initData
                return True
                
        except Exception as e:
            logging.error(f"Error checking transaction {tx_hash}: {e}")
            return False

@router.get("/api/ton-check-tx")
async def ton_check_transaction(request: Request, tx_hash: str):
    """
    Polling endpoint for frontend.
    - Pass tx_hash returned by TonConnect.
    - Backend checks the blockchain (destination + amount) and grants premium if valid.
    - Returns { "status": "pending" } or { "status": "completed" }.
    """
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")
    
    if not tx_hash:
        raise HTTPException(status_code=400, detail="Missing tx_hash")
    
    # Prevent double‑granting for the same tx_hash
    existing = supabase.table("payments").select("id").eq("transaction_id", tx_hash).eq("status", "completed").execute()
    if existing.data:
        return {"status": "completed", "already_granted": True}
    
    valid = await check_transaction_on_chain(tx_hash, user_id)
    if valid:
        await grant_premium(user_id, tx_hash, PAYMENT_AMOUNT)
        return {"status": "completed"}
    else:
        return {"status": "pending"}

@router.get("/api/ton-config")
async def ton_config():
    return {
        "adminAddress": ADMIN_ADDRESS,
        "amount": PAYMENT_AMOUNT,
        "webhookConfigured": False
    }

@router.post("/api/verify-ton-payment")
async def verify_ton_payment_deprecated(request: Request, background_tasks: BackgroundTasks):
    """
    Deprecated: replaced by polling. Kept for backward compatibility.
    """
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")
    
    body = await request.json()
    boc = body.get("boc")
    if not boc:
        raise HTTPException(status_code=400, detail="Missing BOC")
    
    return {
        "success": False,
        "pending": False,
        "error": "This endpoint is deprecated. Please use the new polling method (get tx_hash from TonConnect and call /api/ton-check-tx)."
                }
    
