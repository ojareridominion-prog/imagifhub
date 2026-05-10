# ton_routes.py – Updated with robust address normalization
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


# ========== IMPROVED ADDRESS NORMALIZATION ==========
def normalize_ton_address(addr: str) -> str:
    """
    Convert any TON address to its raw 32-byte hex hash.
    Ensures consistent comparison between User-Friendly (EQ/UQ) and Raw formats.
    """
    addr = addr.strip().lower()
    if not addr:
        return ""

    # Remove workchain prefix if present (e.g., "0:" or "-1:")
    if ":" in addr:
        addr = addr.split(":")[-1]

    # If it is already a 64-character hex string, return it
    if len(addr) == 64 and all(c in "0123456789abcdef" for c in addr):
        return addr

    # Handle User-friendly format (EQ... or UQ...)
    if addr.startswith("eq") or addr.startswith("uq"):
        try:
            # Fix base64 padding and URL-safe characters
            b64 = addr[2:].replace('-', '+').replace('_', '/')
            b64 += "=" * ((4 - len(b64) % 4) % 4)
            
            decoded = base64.b64decode(b64)
            # TON Address structure: [tag(1), workchain(1), hash(32), checksum(2)]
            if len(decoded) >= 34:
                return decoded[2:34].hex().lower()
        except Exception as e:
            logger.error(f"Failed to decode Base64 address {addr}: {e}")

    return addr


# ========== VERIFY TRANSACTION BY TRANSACTION HASH ==========
async def verify_transaction_by_hash(
    tx_hash: str,
    expected_amount_nano: int,
    expected_user_id: int,
    max_retries: int = 3,
    delay_seconds: int = 5
) -> dict | None:
    """Query TonAPI /v2/blockchain/transactions/{tx_hash} with retries."""
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating verification for tx_hash {tx_hash}")
        return {"hash": "dev_tx_hash"}

    if not TON_ADMIN_ADDRESS:
        logger.error("TON_ADMIN_ADDRESS environment variable is not set")
        return None

    clean_hash = tx_hash.lower().replace('0x', '')
    url = f"https://tonapi.io/v2/blockchain/transactions/{clean_hash}"
    headers = {"Authorization": f"Bearer {TONAPI_KEY}"} if TONAPI_KEY else {}

    for attempt in range(1, max_retries + 1):
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                logger.info(f"Attempt {attempt}: Calling TonAPI {url}")
                resp = await client.get(url, headers=headers)

                if resp.status_code == 404:
                    logger.warning(f"Transaction {tx_hash} not found (attempt {attempt}/{max_retries})")
                    if attempt < max_retries:
                        await asyncio.sleep(delay_seconds)
                        continue
                    return None

                if resp.status_code != 200:
                    logger.error(f"TonAPI error {resp.status_code}: {resp.text[:200]}")
                    return None

                tx = resp.json()
                in_msg = tx.get("in_msg")
                if not in_msg:
                    logger.error("No incoming message found in transaction")
                    return None

                # Extract destination address
                destination = in_msg.get("destination")
                dest_addr = destination.get("address", "") if isinstance(destination, dict) else str(destination or "")

                # Normalization comparison
                admin_norm = normalize_ton_address(TON_ADMIN_ADDRESS)
                dest_norm = normalize_ton_address(dest_addr)

                if admin_norm != dest_norm:
                    logger.error(f"Destination mismatch: Received {dest_norm}, Expected {admin_norm}")
                    return None

                # Verify amount
                value = in_msg.get("value")
                if value is None or int(value) < expected_amount_nano:
                    logger.error(f"Amount mismatch or insufficient: {value} < {expected_amount_nano}")
                    return None

                # Verify comment (payload)
                decoded_body = in_msg.get("decoded_body", {})
                comment = decoded_body.get("text", "") or in_msg.get("message", "")
                target_comment = f"user:{expected_user_id}"
                
                if target_comment not in comment:
                    logger.error(f"Comment mismatch: Expected '{target_comment}', got '{comment}'")
                    return None

                return {"hash": tx.get("hash")}

            except Exception as e:
                logger.error(f"Exception during TonAPI call (attempt {attempt}): {e}")
                if attempt < max_retries:
                    await asyncio.sleep(delay_seconds)
                else:
                    return None
    return None


# ========== IDEMPOTENT PREMIUM GRANT ==========
async def verify_and_grant_premium(user_id: int, tx_hash: str) -> bool:
    # Check if transaction was already processed
    existing = supabase.table("payments").select("id").eq("transaction_id", tx_hash).execute()
    if existing.data:
        logger.info(f"Transaction {tx_hash} already processed. Skipping.")
        return True

    now = datetime.utcnow()
    new_expiry = now + timedelta(days=30)

    # Check for existing subscription to stack time
    user_result = supabase.table("users").select("premium_expires_at").eq("telegram_id", user_id).execute()
    if user_result.data and user_result.data[0].get("premium_expires_at"):
        try:
            current_expiry_str = user_result.data[0]["premium_expires_at"].replace('Z', '+00:00')
            current_expiry = datetime.fromisoformat(current_expiry_str).replace(tzinfo=None)
            if current_expiry > now:
                new_expiry = current_expiry + timedelta(days=30)
        except Exception:
            pass

    # Update User Table
    supabase.table("users").upsert({
        "telegram_id": user_id,
        "is_premium": True,
        "premium_expires_at": new_expiry.isoformat(),
        "updated_at": now.isoformat()
    }).execute()

    # Record Payment
    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    supabase.table("payments").insert({
        "telegram_id": user_id,
        "provider": "ton",
        "amount": expected_nano,
        "currency": "nanoTON",
        "payload": f"ton_{user_id}_{tx_hash[:8]}",
        "transaction_id": tx_hash,
        "status": "completed",
        "created_at": now.isoformat()
    }).execute()

    logger.info(f"✅ Premium granted to {user_id}")
    return True


# ========== ENDPOINTS ==========

@router.post("/api/ton-confirm-payment")
async def confirm_payment(request: Request):
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")

    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    tx_hash = body.get("tx_hash")
    if not tx_hash:
        raise HTTPException(status_code=400, detail="Missing tx_hash")

    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    tx_info = await verify_transaction_by_hash(tx_hash, expected_nano, user_id)

    if not tx_info:
        raise HTTPException(status_code=400, detail="Transaction verification failed")

    if await verify_and_grant_premium(user_id, tx_info["hash"]):
        return {"status": "completed", "message": "Premium activated"}
    
    raise HTTPException(status_code=500, detail="Failed to grant premium")


@router.get("/api/ton-config")
async def ton_config():
    return {
        "adminAddress": TON_ADMIN_ADDRESS,
        "amount": TON_AMOUNT
    }
    
