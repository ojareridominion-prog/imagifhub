# ton_routes.py - TON payment verification using Toncenter public API
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

# Toncenter API (public, no key required for basic usage)
TONCENTER_API_URL = "https://toncenter.com/api/v2/"
# Optional: if you have an API key, set it in environment
TONCENTER_API_KEY = os.environ.get("TONCENTER_API_KEY", "")
ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
PAYMENT_AMOUNT = float(os.environ.get("TON_PAYMENT_AMOUNT", 1.12))
DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"

logging.basicConfig(level=logging.INFO)

async def grant_premium(user_id: int, tx_hash: str = None, amount: float = PAYMENT_AMOUNT):
    """Grant or extend premium subscription for 30 days."""
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
        except Exception:
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
    Verify a TON transaction using Toncenter API.
    tx_hash_hex: 64-character hex string (as returned by the wallet)
    expected_amount_nano: minimum nanoTON required (PAYMENT_AMOUNT * 1e9)
    """
    # Convert hex to base64 (Toncenter expects base64 hash)
    try:
        hash_bytes = bytes.fromhex(tx_hash_hex)
        hash_b64 = base64.b64encode(hash_bytes).decode()
        logging.info(f"Checking tx: hex={tx_hash_hex}, b64={hash_b64}")
    except Exception as e:
        logging.error(f"Hash conversion failed: {e}")
        return False

    async with aiohttp.ClientSession() as session:
        # Fetch recent transactions for the admin address
        params = {
            "address": ADMIN_ADDRESS,
            "limit": 50,
            "sort": "desc"
        }
        if TONCENTER_API_KEY:
            params["api_key"] = TONCENTER_API_KEY

        url = f"{TONCENTER_API_URL}getTransactions"
        try:
            async with session.get(url, params=params, timeout=15) as resp:
                if resp.status != 200:
                    logging.warning(f"Toncenter HTTP {resp.status}")
                    return False

                data = await resp.json()
                if not data.get("ok") or not data.get("result"):
                    logging.warning(f"Toncenter API error: {data}")
                    return False

                # Find transaction by hash
                for tx in data["result"]:
                    tx_hash_api = tx.get("transaction_id", {}).get("hash")
                    if tx_hash_api != hash_b64:
                        continue

                    # Check incoming message (in_msg)
                    in_msg = tx.get("in_msg", {})
                    source = in_msg.get("source", "")
                    destination = in_msg.get("destination", "")

                    if not source or not destination:
                        continue

                    # Ensure it's an incoming transfer to admin address
                    if source.lower() != ADMIN_ADDRESS.lower() and destination.lower() == ADMIN_ADDRESS.lower():
                        amount = int(in_msg.get("value", "0"))
                        if amount >= expected_amount_nano:
                            logging.info(f"✅ Transaction verified: {tx_hash_hex}")
                            return True

        except Exception as e:
            logging.warning(f"Toncenter request error: {e}")

    return False

async def verify_payment(user_id: int, tx_hash: str, boc: str, amount_nano: int) -> bool:
    """Main verification logic with retries."""
    if DEV_MODE:
        logging.warning(f"DEV_MODE: Granting premium to {user_id} without on-chain check")
        return True

    # If BOC provided but no hash, compute hash from BOC
    if not tx_hash and boc:
        try:
            boc_bytes = base64.b64decode(boc)
            tx_hash = hashlib.sha256(boc_bytes).hexdigest()
        except Exception as e:
            logging.error(f"BOC hash computation failed: {e}")

    if not tx_hash:
        logging.error("No transaction hash or BOC provided")
        return False

    # Retry up to 25 times (8 seconds each = 200 seconds ≈ 3.3 min)
    for attempt in range(25):
        valid = await check_transaction_on_chain(tx_hash, amount_nano)
        if valid:
            return True
        logging.info(f"Retry {attempt+1}/25 for tx {tx_hash}")
        await asyncio.sleep(8)

    logging.warning(f"Verification failed for {tx_hash} after 25 attempts")
    return False

# ==================== API ENDPOINTS ====================

@router.get("/api/ton-check-tx")
async def ton_check_transaction(request: Request, tx_hash: str):
    """Check if a transaction (by hex hash) is confirmed and grant premium."""
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    # Already processed?
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
    """Alternative endpoint: verify using BOC (bag of cells) from wallet."""
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
    except Exception:
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
    """Return configuration for the frontend."""
    return {
        "adminAddress": ADMIN_ADDRESS,
        "amount": PAYMENT_AMOUNT,
        "webhookConfigured": False
    }

@router.post("/api/verify-ton-payment")
async def verify_ton_payment_deprecated(request: Request):
    """Deprecated endpoint – kept for compatibility."""
    return {"success": False, "error": "Use /api/ton-check-tx or /api/ton-verify-boc"}
    
