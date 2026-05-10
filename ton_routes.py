# ton_routes.py – Complete updated file
import os
import asyncio
import logging
import httpx
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase
from datetime import datetime, timedelta

router = APIRouter()

TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "").strip()
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"
TONAPI_KEY = os.environ.get("TONAPI_KEY", "")
POLL_MAX_SECONDS = 60           # Increased wait up to 60 seconds
POLL_INTERVAL = 3               # Check every 3 seconds

logger = logging.getLogger(__name__)


async def verify_message_by_hash(
    msg_hash: str,
    expected_amount_nano: int,
    expected_comment: str,
    expected_admin_address: str,
    max_retries: int = 20,      # Increased retries
    delay_seconds: int = 3
) -> dict | None:
    """
    Query TonAPI /v2/blockchain/messages/{msg_hash} with extended retry window.
    """
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating verification for msg_hash {msg_hash}")
        return {"hash": msg_hash}

    if not expected_admin_address:
        logger.error("TON_ADMIN_ADDRESS not set")
        return None

    clean_hash = msg_hash.lower().replace('0x', '')
    url = f"https://tonapi.io/v2/blockchain/messages/{clean_hash}"
    headers = {"Authorization": f"Bearer {TONAPI_KEY}"} if TONAPI_KEY else {}

    for attempt in range(1, max_retries + 1):
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                logger.info(f"Attempt {attempt}/{max_retries}: checking message {clean_hash[:16]}...")
                resp = await client.get(url, headers=headers)

                if resp.status_code == 404:
                    logger.warning(f"Message {clean_hash[:16]} not found yet")
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
                logger.info(f"Message data received: {msg_data}")

                # Extract destination and compare
                destination = msg_data.get("destination")
                dest_addr = destination.get("address", "") if isinstance(destination, dict) else str(destination) if destination else ""

                # Normalize both addresses for comparison
                def normalize(addr: str) -> str:
                    if not addr:
                        return ""
                    # Remove any '0:' prefix if present
                    if addr.startswith("0:"):
                        addr = addr[2:]
                    # Convert to lowercase for consistent comparison
                    return addr.lower()

                if normalize(dest_addr) != normalize(expected_admin_address):
                    logger.error(f"Destination mismatch: '{dest_addr}' != '{expected_admin_address}'")
                    return None

                # Extract and compare amount (allow at least expected amount)
                value = msg_data.get("value")
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

                # Extract and compare comment
                decoded_body = msg_data.get("decoded_body", {})
                comment = decoded_body.get("text", "") or msg_data.get("message", "")
                if expected_comment not in comment:
                    logger.error(f"Comment mismatch: expected '{expected_comment}', got '{comment}'")
                    return None

                # All checks passed
                tx_hash = msg_data.get("transaction", {}).get("hash")
                logger.info(f"✅ Message verified: {msg_hash} (tx: {tx_hash})")
                return {"hash": msg_hash}

            except Exception as e:
                logger.error(f"TonAPI exception on attempt {attempt}: {e}", exc_info=True)
                if attempt < max_retries:
                    await asyncio.sleep(delay_seconds)
                else:
                    return None
    return None


async def verify_and_grant_premium(user_id: int, msg_hash: str) -> bool:
    existing = supabase.table("payments").select("id").eq("transaction_id", msg_hash).execute()
    if existing.data:
        logger.info(f"Message {msg_hash} already processed – skipping.")
        return True

    now = datetime.utcnow()
    new_expiry = now + timedelta(days=30)

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

    logger.info(f"✅ Premium granted to user {user_id} via normalized message {msg_hash}")
    return True


@router.post("/api/ton-confirm-payment")
async def confirm_payment(request: Request):
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")

    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    msg_hash = body.get("norm_hash")
    if not msg_hash:
        raise HTTPException(status_code=400, detail="Missing normalized message hash")

    expected_comment = f"user:{user_id}"
    expected_nano = int(TON_AMOUNT * 1_000_000_000)

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


@router.get("/api/ton-config")
async def ton_config():
    return {"adminAddress": TON_ADMIN_ADDRESS, "amount": TON_AMOUNT}


@router.get("/debug/admin-raw")
async def debug_admin_raw():
    return {
        "env_raw": TON_ADMIN_ADDRESS,
        "note": "Address used as-is for string comparison."
    }
    
