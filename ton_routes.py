# ton_routes.py - Fixed TON Center API calls (converts hex hash to base64 for /getTransaction,
#                 fallback fetches recent admin transactions and matches by amount + hash)
from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timedelta
import logging
import os
import hashlib
import base64
import aiohttp
import asyncio
from config import supabase
from utils import get_user_id_from_init_data

router = APIRouter()

TON_API_KEY = os.environ.get("TONCENTER_API_KEY", "")
ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
PAYMENT_AMOUNT = float(os.environ.get("TON_PAYMENT_AMOUNT", 1.12))
DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"

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

async def check_transaction_on_chain(tx_hash_hex: str, expected_amount_nano: int) -> bool:
    """
    Verify a transaction using TON Center's API.
    - tx_hash_hex: 64-character hex string
    - expected_amount_nano: amount in nanoTON that should have been sent to ADMIN_ADDRESS
    """
    if not TON_API_KEY or not ADMIN_ADDRESS:
        logging.error("Missing TON API config: TON_API_KEY or ADMIN_ADDRESS empty")
        return False

    # Convert hex to base64 (required by /getTransaction)
    try:
        hash_bytes = bytes.fromhex(tx_hash_hex)
        hash_b64 = base64.b64encode(hash_bytes).decode()
    except Exception as e:
        logging.error(f"Failed to convert hash to base64: {e}")
        return False

    # 1. Try /getTransaction with base64 hash (most efficient)
    url = "https://toncenter.com/api/v2/getTransaction"
    params = {
        "hash": hash_b64,
        "api_key": TON_API_KEY
    }
    logging.info(f"Checking tx with base64 hash: {hash_b64}")

    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(url, params=params, timeout=15) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data.get("ok") and data.get("result"):
                        tx = data["result"]
                        out_msgs = tx.get("out_msgs", [])
                        for msg in out_msgs:
                            dest = msg.get("destination", "")
                            if dest.lower() == ADMIN_ADDRESS.lower():
                                amount = int(msg.get("value", "0"))
                                if amount >= expected_amount_nano:
                                    logging.info(f"✅ Transaction verified via /getTransaction: {tx_hash_hex}")
                                    return True
                else:
                    logging.warning(f"TON API error: HTTP {resp.status}")
        except Exception as e:
            logging.warning(f"/getTransaction error: {e}")

    # 2. Fallback: fetch recent transactions for admin address and match by amount + hash
    url = "https://toncenter.com/api/v2/getTransactions"
    params = {
        "address": ADMIN_ADDRESS,
        "limit": 30,
        "sort": "desc",   # newest first
        "api_key": TON_API_KEY
    }
    try:
        async with session.get(url, params=params, timeout=15) as resp:
            if resp.status == 200:
                data = await resp.json()
                if data.get("ok") and data.get("result"):
                    for tx in data["result"]:
                        # Get the transaction hash from the API response (base64 encoded)
                        tx_hash_from_api = tx.get("transaction_id", {}).get("hash")
                        if tx_hash_from_api != hash_b64:
                            continue
                        in_msg = tx.get("in_msg", {})
                        # Ensure the incoming message is from an external sender (source not admin)
                        if in_msg.get("source") and in_msg["source"].lower() != ADMIN_ADDRESS.lower():
                            dest = in_msg.get("destination", "")
                            if dest.lower() == ADMIN_ADDRESS.lower():
                                amount = int(in_msg.get("value", "0"))
                                if amount >= expected_amount_nano:
                                    logging.info(f"✅ Transaction verified via fallback: {tx_hash_hex}")
                                    return True
            else:
                logging.warning(f"Fallback API error: HTTP {resp.status}")
    except Exception as e:
        logging.error(f"Fallback verification error: {e}")

    return False

async def verify_payment(user_id: int, tx_hash: str, boc: str, amount_nano: int) -> bool:
    if DEV_MODE:
        logging.warning(f"DEV_MODE: Granting premium to {user_id} without on-chain verification")
        return True

    # Compute hash from BOC if needed
    if not tx_hash and boc:
        try:
            boc_bytes = base64.b64decode(boc)
            tx_hash = hashlib.sha256(boc_bytes).hexdigest()
        except Exception as e:
            logging.error(f"BOC hash computation failed: {e}")

    if not tx_hash:
        logging.error("No tx_hash or BOC provided")
        return False

    # Retry up to 20 times with 10 second intervals (total ~3.3 minutes)
    for attempt in range(20):
        valid = await check_transaction_on_chain(tx_hash, amount_nano)
        if valid:
            return True
        logging.info(f"Retry {attempt+1}/20 for tx {tx_hash}")
        await asyncio.sleep(10)

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
    return {"success": False, "error": "Use /api/ton-check-tx or /api/ton-verify-boc"}
    
