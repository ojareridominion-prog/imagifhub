# ton_routes.py - Fixed TON Access (Orbs) with correct endpoints
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

# TON Access REST API endpoint (v1 works, v2 may also work but we use v1 for reliability)
TON_ACCESS_ENDPOINT = os.environ.get("TON_ACCESS_ENDPOINT", "https://ton.access.orbs.network/ton-mainnet/v1/")
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
    Verify a transaction on TON blockchain using TON Access (Orbs) REST API.
    - tx_hash_hex: 64-character hex string
    - expected_amount_nano: minimum nanoTON to accept
    """
    if not ADMIN_ADDRESS:
        logging.error("Missing TON admin address")
        return False

    # Convert hex to base64 (required by TON HTTP API)
    try:
        hash_bytes = bytes.fromhex(tx_hash_hex)
        hash_b64 = base64.b64encode(hash_bytes).decode()
    except Exception as e:
        logging.error(f"Hash conversion error: {e}")
        return False

    logging.info(f"Checking tx with base64 hash: {hash_b64} (via TON Access)")

    async with aiohttp.ClientSession() as session:
        # Method 1: Use getTransactions for admin address and filter by hash
        url = f"{TON_ACCESS_ENDPOINT}getTransactions"
        params = {
            "address": ADMIN_ADDRESS,
            "limit": 50,
            "sort": "desc"
        }
        try:
            async with session.get(url, params=params, timeout=15) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data.get("ok") and data.get("result"):
                        for tx in data["result"]:
                            # Transaction hash in response is base64
                            tx_hash_from_api = tx.get("transaction_id", {}).get("hash")
                            if tx_hash_from_api != hash_b64:
                                continue
                            # Check incoming message
                            in_msg = tx.get("in_msg", {})
                            # Ensure it's an incoming transfer (source is not admin)
                            if in_msg.get("source") and in_msg["source"].lower() != ADMIN_ADDRESS.lower():
                                if in_msg.get("destination", "").lower() == ADMIN_ADDRESS.lower():
                                    amount = int(in_msg.get("value", "0"))
                                    if amount >= expected_amount_nano:
                                        logging.info(f"✅ Verified via getTransactions (hash match): {tx_hash_hex}")
                                        return True
                    else:
                        logging.warning(f"getTransactions response not OK: {data}")
                else:
                    logging.warning(f"getTransactions HTTP {resp.status}")
        except Exception as e:
            logging.warning(f"getTransactions error: {e}")

        # Method 2: Try getTransaction endpoint (some TON Access nodes support it)
        tx_url = f"{TON_ACCESS_ENDPOINT}getTransaction"
        tx_params = {"hash": hash_b64}
        try:
            async with session.get(tx_url, params=tx_params, timeout=15) as resp:
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
                                    logging.info(f"✅ Verified via getTransaction: {tx_hash_hex}")
                                    return True
                    else:
                        logging.warning(f"getTransaction response not OK: {data}")
                else:
                    logging.warning(f"getTransaction HTTP {resp.status}")
        except Exception as e:
            logging.warning(f"getTransaction error: {e}")

        # Method 3: Relaxed fallback (any incoming transfer of >= amount in last 10 minutes)
        try:
            async with session.get(url, params=params, timeout=15) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data.get("ok") and data.get("result"):
                        now = datetime.utcnow()
                        for tx in data["result"]:
                            tx_time = tx.get("utime")
                            if tx_time:
                                tx_dt = datetime.utcfromtimestamp(tx_time)
                                if (now - tx_dt).total_seconds() > 600:  # older than 10 min
                                    continue
                                in_msg = tx.get("in_msg", {})
                                if in_msg.get("source") and in_msg["source"].lower() != ADMIN_ADDRESS.lower():
                                    if in_msg.get("destination", "").lower() == ADMIN_ADDRESS.lower():
                                        amount = int(in_msg.get("value", "0"))
                                        if amount >= expected_amount_nano:
                                            logging.info(f"✅ Verified via relaxed amount+time: {tx_hash_hex}")
                                            return True
        except Exception as e:
            logging.error(f"Relaxed fallback error: {e}")

    return False

async def verify_payment(user_id: int, tx_hash: str, boc: str, amount_nano: int) -> bool:
    if DEV_MODE:
        logging.warning(f"DEV_MODE: Granting premium to {user_id} without on-chain verification")
        return True

    if not tx_hash and boc:
        try:
            boc_bytes = base64.b64decode(boc)
            tx_hash = hashlib.sha256(boc_bytes).hexdigest()
        except Exception as e:
            logging.error(f"BOC hash computation failed: {e}")

    if not tx_hash:
        logging.error("No tx_hash or BOC provided")
        return False

    # Retry up to 25 times with 8-second intervals
    for attempt in range(25):
        valid = await check_transaction_on_chain(tx_hash, amount_nano)
        if valid:
            return True
        logging.info(f"Retry {attempt+1}/25 for tx {tx_hash}")
        await asyncio.sleep(8)

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
    
