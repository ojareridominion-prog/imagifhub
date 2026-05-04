# ton_routes.py - with fallback grant on timeout (dev mode)
from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timedelta
import logging
import os
import hashlib
import base64
import aiohttp
from config import supabase
from utils import get_user_id_from_init_data

router = APIRouter()

TON_API_KEY = os.environ.get("TONCENTER_API_KEY", "")
ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
PAYMENT_AMOUNT = float(os.environ.get("TON_PAYMENT_AMOUNT", 1.12))
DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"  # set to true for testing

logging.basicConfig(level=logging.INFO)

async def grant_premium(user_id: int, tx_hash: str = None, amount: float = PAYMENT_AMOUNT):
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
        "transaction_id": tx_hash or f"fallback_{user_id}",
        "status": "completed"
    }).execute()
    logging.info(f"✅ Premium granted to {user_id} until {new_expiry.isoformat()}")
    return True

async def check_transaction_on_chain(tx_hash: str, expected_amount_nano: int) -> bool:
    """Return True if a valid tx to ADMIN_ADDRESS with sufficient amount exists."""
    if not TON_API_KEY or not ADMIN_ADDRESS:
        logging.error("Missing TON API config")
        return False

    # Try both hex and base64 decoding
    hash_bytes = None
    for attempt in [tx_hash, tx_hash.replace('0x', '')]:
        try:
            if len(attempt) == 64:  # hex
                hash_bytes = bytes.fromhex(attempt)
            elif len(attempt) == 44:  # base64
                hash_bytes = base64.b64decode(attempt)
            if hash_bytes:
                break
        except:
            continue

    if not hash_bytes:
        logging.error(f"Unable to decode tx_hash: {tx_hash}")
        return False

    # URL-encoded raw hash for TON Center API
    raw_hash_base64 = base64.b64encode(hash_bytes).decode()
    url = "https://toncenter.com/api/v2/getTransactions"
    params = {
        "address": ADMIN_ADDRESS,
        "hash": raw_hash_base64,
        "limit": 1,
        "api_key": TON_API_KEY
    }
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(url, params=params, timeout=10) as resp:
                if resp.status != 200:
                    logging.warning(f"TON API error: {resp.status}")
                    return False
                data = await resp.json()
                if not data.get("ok") or not data.get("result"):
                    logging.info(f"Transaction {tx_hash} not found")
                    return False
                tx = data["result"][0]
                in_msg = tx.get("in_msg", {})
                dest = in_msg.get("destination", "") or in_msg.get("dest", "")
                if dest.lower() != ADMIN_ADDRESS.lower():
                    logging.warning(f"Wrong dest: {dest}")
                    return False
                amount_nano = int(in_msg.get("value", "0"))
                if amount_nano < expected_amount_nano:
                    logging.warning(f"Amount too low: {amount_nano} < {expected_amount_nano}")
                    return False
                logging.info(f"✅ Transaction verified on chain: {tx_hash}")
                return True
        except Exception as e:
            logging.error(f"Check error: {e}")
            return False

async def verify_payment(user_id: int, tx_hash: str, boc: str, amount_nano: int) -> bool:
    # If dev mode, grant immediately without blockchain check
    if DEV_MODE:
        logging.warning(f"DEV_MODE: Granting premium to {user_id} without on-chain verification")
        return True

    # First compute hash from BOC if tx_hash missing
    if not tx_hash and boc:
        try:
            boc_bytes = base64.b64decode(boc)
            tx_hash = hashlib.sha256(boc_bytes).hexdigest()
        except:
            pass

    if not tx_hash:
        logging.error("No tx_hash or BOC provided")
        return False

    # Now check on chain (with retries)
    for attempt in range(8):  # 8 attempts, total ~20-30 seconds
        valid = await check_transaction_on_chain(tx_hash, amount_nano)
        if valid:
            return True
        await asyncio.sleep(5)
    logging.warning(f"On-chain verification failed for {tx_hash} after multiple attempts")
    return False

@router.get("/api/ton-check-tx")
async def ton_check_transaction(request: Request, tx_hash: str):
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    existing = supabase.table("payments").select("id").eq("transaction_id", tx_hash).eq("status", "completed").execute()
    if existing.data:
        return {"status": "completed"}

    amount_nano = int(PAYMENT_AMOUNT * 1e9)
    valid = await verify_payment(user_id, tx_hash, "", amount_nano)
    if valid:
        await grant_premium(user_id, tx_hash, PAYMENT_AMOUNT)
        return {"status": "completed"}
    return {"status": "pending"}

@router.post("/api/ton-verify-boc")
async def ton_verify_boc(request: Request):
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

    # Compute tx_hash from BOC
    try:
        boc_bytes = base64.b64decode(boc)
        tx_hash = hashlib.sha256(boc_bytes).hexdigest()
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid BOC")

    existing = supabase.table("payments").select("id").eq("transaction_id", tx_hash).eq("status", "completed").execute()
    if existing.data:
        return {"status": "completed"}

    amount_nano = int(PAYMENT_AMOUNT * 1e9)
    valid = await verify_payment(user_id, tx_hash, boc, amount_nano)
    if valid:
        await grant_premium(user_id, tx_hash, PAYMENT_AMOUNT)
        return {"status": "completed"}
    return {"status": "pending"}

@router.get("/api/ton-config")
async def ton_config():
    return {
        "adminAddress": ADMIN_ADDRESS,
        "amount": PAYMENT_AMOUNT,
        "webhookConfigured": False
    }

@router.post("/api/verify-ton-payment")
async def verify_ton_payment_deprecated(request: Request):
    # Deprecated – kept for compatibility
    return {"success": False, "error": "Use /api/ton-check-tx or /api/ton-verify-boc"}
    
