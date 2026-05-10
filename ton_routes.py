# ton_routes.py – Message‑hash based verification (corrected)
import os
import asyncio
import logging
import httpx
import base64
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase
from datetime import datetime, timedelta

router = APIRouter()

# ========== ENVIRONMENT VARIABLES ==========
TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))          # in TON
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"
TONAPI_KEY = os.environ.get("TONAPI_KEY", "")

logger = logging.getLogger(__name__)


# ========== ADDRESS NORMALIZATION (FIXED) ==========
def normalize_ton_address(addr: str) -> str:
    """
    Convert any TON address to raw hex (without 0: prefix).
    Handles raw hex (0:...), raw hex without prefix, and user‑friendly (EQ/UQ...).
    """
    addr = addr.strip()
    if not addr:
        return ""

    # Already a raw hex value (64 chars) without workchain prefix
    if len(addr) == 64 and all(c in "0123456789abcdefABCDEF" for c in addr):
        return addr.lower()

    # Raw hex with workchain prefix (e.g., "0:...")
    if ":" in addr:
        return addr.split(":")[-1].lower()

    # User‑friendly format (EQ... or UQ...)
    if addr.startswith("EQ") or addr.startswith("UQ"):
        b64 = addr[2:].replace('-', '+').replace('_', '/')
        missing = len(b64) % 4
        if missing:
            b64 += '=' * (4 - missing)
        try:
            decoded = base64.b64decode(b64)
            # decoded structure: [tag(1), workchain(1), address(32), checksum(2)]
            # The actual raw address is bytes 2..34 (32 bytes)
            if len(decoded) >= 34:
                hex_part = decoded[2:34].hex()
                return hex_part.lower()
            else:
                logger.error(f"Unexpected decoded address length: {len(decoded)}")
        except Exception as e:
            logger.error(f"Failed to decode Base64 address: {e}")

    # Fallback: return as is lowercase
    return addr.lower()


# ========== VERIFY MESSAGE BY MESSAGE HASH (CORRECT ENDPOINT) ==========
async def verify_message_by_hash(
    msg_hash: str,
    expected_amount_nano: int,
    expected_comment: str,
    expected_admin_raw: str,
    max_retries: int = 2,
    delay_seconds: int = 3
) -> dict | None:
    """
    Query TonAPI /v2/blockchain/messages/{msg_hash} and verify destination, amount, comment.
    This is the correct endpoint for a message hash (cell hash).
    """
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating verification for msg_hash {msg_hash}")
        return {"hash": msg_hash, "transaction_hash": "dev_tx"}

    if not TON_ADMIN_ADDRESS:
        logger.error("TON_ADMIN_ADDRESS not set")
        return None

    clean_hash = msg_hash.lower().replace('0x', '')
    url = f"https://tonapi.io/v2/blockchain/messages/{clean_hash}"
    headers = {"Authorization": f"Bearer {TONAPI_KEY}"} if TONAPI_KEY else {}

    for attempt in range(1, max_retries + 1):
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                logger.info(f"Attempt {attempt}: Calling TonAPI message endpoint {url}")
                resp = await client.get(url, headers=headers)

                if resp.status_code == 404:
                    logger.warning(f"Message {msg_hash} not found yet (attempt {attempt}/{max_retries})")
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

                # Extract destination
                destination = msg_data.get("destination")
                if isinstance(destination, dict):
                    dest_addr = destination.get("address", "")
                else:
                    dest_addr = str(destination) if destination else ""

                # Extract value (amount in nanoTON)
                value = msg_data.get("value")
                # Extract comment (from decoded_body.text or raw message)
                decoded_body = msg_data.get("decoded_body", {})
                comment = decoded_body.get("text", "") or msg_data.get("message", "")

                # Normalize addresses for comparison
                dest_norm = normalize_ton_address(dest_addr)
                admin_norm = expected_admin_raw  # already normalized

                logger.info(f"Admin normalized: {admin_norm}")
                logger.info(f"Destination normalized: {dest_norm}")

                # Verify destination
                if dest_norm != admin_norm:
                    logger.error(f"Destination mismatch: {dest_norm} != {admin_norm}")
                    return None

                # Verify amount
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

                # Verify comment contains expected user ID
                if expected_comment not in comment:
                    logger.error(f"Comment mismatch: expected '{expected_comment}', got '{comment}'")
                    return None

                # All checks passed
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
    # Check if this message hash has already been processed
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
        except Exception:
            pass

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
    """
    Receive message hash (cell hash) from frontend, verify via TonAPI message endpoint,
    then grant premium.
    """
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")

    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    msg_hash = body.get("tx_hash")   # Note: frontend sends this as 'tx_hash' but it's the message hash
    if not msg_hash:
        raise HTTPException(status_code=400, detail="Missing message hash")

    expected_comment = f"user:{user_id}"
    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    admin_raw = normalize_ton_address(TON_ADMIN_ADDRESS)

    if not admin_raw:
        raise HTTPException(status_code=500, detail="Admin address not configured correctly")

    verification = await verify_message_by_hash(
        msg_hash=msg_hash,
        expected_amount_nano=expected_nano,
        expected_comment=expected_comment,
        expected_admin_raw=admin_raw
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
    """Debug endpoint to see normalized admin address."""
    return {
        "env_raw": TON_ADMIN_ADDRESS,
        "normalized": normalize_ton_address(TON_ADMIN_ADDRESS)
                }
    
