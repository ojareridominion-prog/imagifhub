# ton_routes.py – Poll user wallet for outgoing transaction
import os
import asyncio
import logging
import httpx
import base64
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase
from datetime import datetime, timedelta
import hashlib

router = APIRouter()

TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "").strip()
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"
TONAPI_KEY = os.environ.get("TONAPI_KEY", "")
POLL_MAX_SECONDS = 45
POLL_INTERVAL = 3

logger = logging.getLogger(__name__)

async def fetch_recent_transactions(wallet_address: str, limit: int = 20):
    """Fetch recent transactions for a given wallet using TonAPI."""
    url = f"https://tonapi.io/v2/accounts/{wallet_address}/transactions"
    headers = {"Authorization": f"Bearer {TONAPI_KEY}"} if TONAPI_KEY else {}
    params = {"limit": limit}

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, headers=headers, params=params)
            if resp.status_code != 200:
                logger.error(f"TonAPI error {resp.status_code}: {resp.text[:200]}")
                return []
            data = resp.json()
            return data.get("transactions", [])
        except Exception as e:
            logger.error(f"Failed to fetch transactions: {e}")
            return []

def extract_outgoing_messages(transactions, admin_address: str):
    """
    From a list of transactions, yield (tx_hash, amount_nano, comment, timestamp)
    for outgoing messages where destination == admin_address.
    """
    for tx in transactions:
        tx_hash = tx.get("hash")
        out_msgs = tx.get("out_msgs", [])
        for msg in out_msgs:
            dest = msg.get("destination", {})
            dest_addr = dest.get("address", "") if isinstance(dest, dict) else str(dest) if dest else ""
            if dest_addr != admin_address:
                continue
            value = msg.get("value")
            if value is None:
                continue
            comment = ""
            decoded = msg.get("decoded_body", {})
            if decoded and isinstance(decoded, dict):
                comment = decoded.get("text", "")
            elif "body" in msg and msg["body"]:
                # fallback: try to parse text from raw body
                pass
            utime = tx.get("utime", 0)
            yield tx_hash, int(value), comment, int(utime)

async def poll_for_payment(user_id: int, user_wallet: str, admin_addr: str,
                           expected_comment_prefix: str, expected_nano: int,
                           max_wait: int = POLL_MAX_SECONDS, interval: int = POLL_INTERVAL):
    """
    Poll the user's wallet for up to max_wait seconds.
    Returns (tx_hash, amount, comment) if found, else None.
    """
    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < max_wait:
        transactions = await fetch_recent_transactions(user_wallet, limit=20)
        for tx_hash, amount, comment, utime in extract_outgoing_messages(transactions, admin_addr):
            # Check comment matches expected pattern
            if comment.startswith(expected_comment_prefix):
                if amount >= expected_nano:
                    # Check idempotency
                    existing = supabase.table("payments").select("id").eq("transaction_id", tx_hash).execute()
                    if not existing.data:
                        return tx_hash, amount, comment
                    else:
                        logger.info(f"Tx {tx_hash} already processed – ignoring duplicate")
                        continue
        await asyncio.sleep(interval)
    return None

async def grant_premium(user_id: int, tx_hash: str, amount_nano: int, comment: str):
    """Idempotent premium activation and payment record insertion."""
    now = datetime.utcnow()
    new_expiry = now + timedelta(days=30)

    # Extend existing premium if still valid
    user_result = supabase.table("users").select("premium_expires_at").eq("telegram_id", user_id).execute()
    if user_result.data and user_result.data[0].get("premium_expires_at"):
        current_expiry_str = user_result.data[0]["premium_expires_at"]
        try:
            if current_expiry_str.endswith('Z'):
                current_expiry_str = current_expiry_str.replace('Z', '+00:00')
            current_expiry = datetime.fromisoformat(current_expiry_str)
            if current_expiry.tzinfo:
                current_expiry = current_expiry.replace(tzinfo=None)
            if current_expiry > now and current_expiry > new_expiry:
                new_expiry = current_expiry + timedelta(days=30)
        except Exception as e:
            logger.warning(f"Could not parse expiry: {e}")

    supabase.table("users").upsert({
        "telegram_id": user_id,
        "is_premium": True,
        "premium_expires_at": new_expiry.isoformat(),
        "updated_at": now.isoformat()
    }).execute()

    supabase.table("payments").insert({
        "telegram_id": user_id,
        "provider": "ton",
        "amount": amount_nano,
        "currency": "nanoTON",
        "payload": comment[:100],           # store comment as payload
        "transaction_id": tx_hash,
        "status": "completed",
        "created_at": now.isoformat()
    }).execute()

    logger.info(f"✅ Premium granted to user {user_id} via tx {tx_hash}")
    return True

@router.post("/api/ton-confirm-payment")
async def confirm_payment(request: Request):
    """
    Receive user's wallet address (sender) and expected comment.
    Poll user's wallet for the outgoing transaction to the admin address.
    """
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")

    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    user_wallet = body.get("user_wallet")
    expected_comment = body.get("comment")     # e.g. "user:123456"

    if not user_wallet:
        raise HTTPException(status_code=400, detail="Missing user_wallet address")
    if not expected_comment:
        raise HTTPException(status_code=400, detail="Missing expected comment")

    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    logger.info(f"Polling for user {user_id}, wallet {user_wallet}, comment {expected_comment}")

    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating successful payment")
        await grant_premium(user_id, "simulated_tx_hash", expected_nano, expected_comment)
        return {"status": "completed", "message": "Premium activated (dev mode)"}

    if not TON_ADMIN_ADDRESS:
        raise HTTPException(status_code=500, detail="Admin address not configured")

    result = await poll_for_payment(
        user_id=user_id,
        user_wallet=user_wallet,
        admin_addr=TON_ADMIN_ADDRESS,
        expected_comment_prefix=expected_comment,
        expected_nano=expected_nano,
        max_wait=POLL_MAX_SECONDS,
        interval=POLL_INTERVAL
    )

    if not result:
        raise HTTPException(status_code=400, detail="Transaction not found or insufficient amount after polling")

    tx_hash, amount, comment = result
    await grant_premium(user_id, tx_hash, amount, comment)
    return {"status": "completed", "message": "Premium activated"}

@router.get("/api/ton-config")
async def ton_config():
    return {"adminAddress": TON_ADMIN_ADDRESS, "amount": TON_AMOUNT}

@router.get("/debug/ton-payment")
async def debug_ton_payment():
    return {
        "admin_address_env": TON_ADMIN_ADDRESS,
        "ton_amount": TON_AMOUNT,
        "tonapi_key_configured": bool(TONAPI_KEY),
        "dev_mode": TON_DEV_MODE,
        "poll_max_seconds": POLL_MAX_SECONDS,
        "poll_interval": POLL_INTERVAL,
        "troubleshooting_tips": [
            "Ensure TON_ADMIN_ADDRESS is correct (e.g. EQ... or UQ...)",
            "Check that TonAPI key is valid",
            "The user's wallet must be connected and the transaction sent to the admin address",
            "The comment must start exactly with 'user:{telegram_id}'"
        ]
    }
    
