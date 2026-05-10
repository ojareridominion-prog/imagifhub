# ton_routes.py – Fixed address comparison + increased retries
import os
import asyncio
import logging
import httpx
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase
from datetime import datetime, timedelta

router = APIRouter()

# ========== ENVIRONMENT VARIABLES ==========
TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "").strip()
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))          # in TON
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"
TONAPI_KEY = os.environ.get("TONAPI_KEY", "")

logger = logging.getLogger(__name__)


# ========== VERIFY MESSAGE BY MESSAGE HASH (DIRECT ADDRESS COMPARE) ==========
async def verify_message_by_hash(
    msg_hash: str,
    expected_amount_nano: int,
    expected_comment: str,
    expected_admin_address: str,
    max_retries: int = 5,
    delay_seconds: int = 4
) -> dict | None:
    """
    Query TonAPI /v2/blockchain/messages/{msg_hash} and verify:
    - Destination matches the admin address (string comparison, no hex conversion)
    - Amount >= expected
    - Comment contains expected user ID
    """
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating verification for msg_hash {msg_hash}")
        return {"hash": msg_hash, "transaction_hash": "dev_tx"}

    if not expected_admin_address:
        logger.error("TON_ADMIN_ADDRESS not set")
        return None

    clean_hash = msg_hash.lower().replace('0x', '')
    url = f"https://tonapi.io/v2/blockchain/messages/{clean_hash}"
    headers = {"Authorization": f"Bearer {TONAPI_KEY}"} if TONAPI_KEY else {}

    for attempt in range(1, max_retries + 1):
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                logger.info(f"Attempt {attempt}/{max_retries}: calling {url}")
                resp = await client.get(url, headers=headers)

                if resp.status_code == 404:
                    logger.warning(f"Message {msg_hash} not found yet")
                    if attempt < max_retries:
                        await asyncio.sleep(delay_seconds)
                        continue
                    else:
                        logger.error("Message not found after all retries")
                        return None

                if resp.status_code != 200:
                    logger.error(f"TonAPI error {resp.status_code}: {resp.text[:200]}")
                    return None

                msg_data = resp.json()

                # Destination – as a user‑friendly string (no conversion needed)
                destination = msg_data.get("destination")
                if isinstance(destination, dict):
                    dest_addr = destination.get("address", "")
                else:
                    dest_addr = str(destination) if destination else ""

                # Amount (in nanoTON)
                value = msg_data.get("value")
                # Comment (from decoded_body or raw message)
                decoded_body = msg_data.get("decoded_body", {})
                comment = decoded_body.get("text", "") or msg_data.get("message", "")

                logger.info(f"Admin address (env): {expected_admin_address}")
                logger.info(f"Destination from API: {dest_addr}")

                # Direct string comparison (both are user‑friendly)
                if dest_addr != expected_admin_address:
                    logger.error(f"Destination mismatch: '{dest_addr}' != '{expected_admin_address}'")
                    return None

                if value is None:
                    logger.error("Amount missing")
                    return None
                try:
                    value_nano = int(value)
                except (ValueError, TypeError):
                    logger.error(f"Invalid amount format: {value}")
                    return None

                if value_nano < expected_amount_nano:
                    logger.error(f"Amount too low: {value_nano} < {expected_amount_nano}")
                    return None

                if expected_comment not in comment:
                    logger.error(f"Comment mismatch: expected '{expected_comment}', got '{comment}'")
                    return None

                tx_hash = msg_data.get("transaction", {}).get("hash")
                logger.info(f"✅ Message verified: {msg_hash} (tx: {tx_hash})")
                return {"hash": msg_hash, "transaction_hash": tx_hash}

            except Exception as e:
                logger.error(f"TonAPI exception on attempt {attempt}: {e}", exc_info=True)
                if attempt < max_retries:
                    await asyncio.sleep(delay_seconds)
                else:
                    return None

    return None


# ========== IDEMPOTENT PREMIUM GRANT ==========
async def verify_and_grant_premium(user_id: int, msg_hash: str) -> bool:
    """Grant premium using message hash as unique idempotency key."""
    existing = supabase.table("payments").select("id").eq("transaction_id", msg_hash).execute()
    if existing.data and len(existing.data) > 0:
        logger.info(f"Message {msg_hash} already processed – skipping.")
        return True

    now = datetime.utcnow()
    new_expiry = now + timedelta(days=30)

    # Extend existing premium if present
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

    # Upsert premium user
    supabase.table("users").upsert({
        "telegram_id": user_id,
        "is_premium": True,
        "premium_expires_at": new_expiry.isoformat(),
        "updated_at": now.isoformat()
    }).execute()

    # Record payment
    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    supabase.table("payments").insert({
        "telegram_id": user_id,
        "provider": "ton",
        "amount": expected_nano,
        "currency": "nanoTON",
        "payload": f"ton_{user_id}_{msg_hash[:8]}",
        "transaction_id": msg_hash,
        "status": "completed",
        "created_at": now.isoformat()
    }).execute()

    logger.info(f"✅ Premium granted to user {user_id} via message {msg_hash}")
    return True


# ========== ENDPOINT: CONFIRM TON PAYMENT ==========
@router.post("/api/ton-confirm-payment")
async def confirm_payment(request: Request):
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")

    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    msg_hash = body.get("tx_hash")   # This is the message hash (cell hash)
    if not msg_hash:
        raise HTTPException(status_code=400, detail="Missing message hash")

    expected_comment = f"user:{user_id}"
    expected_nano = int(TON_AMOUNT * 1_000_000_000)

    if not TON_ADMIN_ADDRESS:
        raise HTTPException(status_code=500, detail="Admin address not configured")

    verification = await verify_message_by_hash(
        msg_hash=msg_hash,
        expected_amount_nano=expected_nano,
        expected_comment=expected_comment,
        expected_admin_address=TON_ADMIN_ADDRESS
    )

    if not verification:
        raise HTTPException(status_code=400, detail="Message verification failed")

    success = await verify_and_grant_premium(user_id, verification["hash"])
    if not success:
        raise HTTPException(status_code=500, detail="Failed to grant premium")

    return {"status": "completed", "message": "Premium activated"}


# ========== CONFIGURATION ENDPOINT ==========
@router.get("/api/ton-config")
async def ton_config():
    return {
        "adminAddress": TON_ADMIN_ADDRESS,
        "amount": TON_AMOUNT
    }


@router.get("/debug/admin-raw")
async def debug_admin_raw():
    """Debug endpoint – shows the exact admin address as used."""
    return {
        "env_raw": TON_ADMIN_ADDRESS,
        "note": "Address is used as‑is for string comparison (no hex conversion)."
                         }
    
