# ton_routes.py
import os
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
TONAPI_KEY = os.environ.get("TONAPI_KEY", "")                     # optional for TonAPI

# TonAPI endpoint (mainnet) – corrected path
TONAPI_URL = "https://tonapi.io/v2/blockchain/transactions/by_message_hash"

logger = logging.getLogger(__name__)


# ========== ADDRESS NORMALIZATION ==========
def normalize_ton_address(addr: str) -> str:
    """
    Convert any TON address to its raw hex representation (without 0: prefix).
    Handles raw hex (0:...), raw hex without prefix, and user‑friendly (EQ/UQ...).
    """
    addr = addr.strip()
    if not addr:
        return ""

    # Already raw hex without prefix?
    if len(addr) == 64 and all(c in "0123456789abcdefABCDEF" for c in addr):
        return addr.lower()

    # Raw hex with 0: prefix
    if addr.startswith("0:"):
        return addr[2:].lower()

    # User‑friendly format (EQ... or UQ...)
    if addr.startswith("EQ") or addr.startswith("UQ"):
        b64 = addr[2:].replace('-', '+').replace('_', '/')
        missing = len(b64) % 4
        if missing:
            b64 += '=' * (4 - missing)
        try:
            decoded = base64.b64decode(b64)
            hex_part = decoded[1:].hex()
            return hex_part
        except Exception:
            pass

    # Fallback: return as is (lowercase)
    return addr.lower()


# ========== CORE: VERIFY TRANSACTION BY MESSAGE HASH (TonAPI) ==========
async def verify_by_msg_hash(msg_hash: str, expected_amount_nano: int, expected_user_id: int) -> dict | None:
    """
    Call TonAPI /v2/blockchain/transactions/by_message_hash/{msg_hash}
    Returns dict with at least {"hash": tx_hash} if valid, else None.
    """
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating verification for msg_hash {msg_hash}")
        return {"hash": "dev_tx_hash"}

    if not TON_ADMIN_ADDRESS:
        logger.error("TON_ADMIN_ADDRESS not set")
        return None

    headers = {}
    if TONAPI_KEY:
        headers["Authorization"] = f"Bearer {TONAPI_KEY}"

    url = f"{TONAPI_URL}/{msg_hash}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                logger.error(f"TonAPI error {resp.status_code}: {resp.text}")
                return None

            tx = resp.json()
            tx_hash = tx.get("hash")
            if not tx_hash:
                logger.error("Transaction hash missing in TonAPI response")
                return None

            # Extract out_msgs (should contain the sent message)
            out_msgs = tx.get("out_msgs", [])
            if not out_msgs:
                logger.error("No out_msgs in transaction")
                return None

            msg = out_msgs[0]
            destination = msg.get("destination", "")
            value = msg.get("value")
            comment = msg.get("message", "")

            admin_norm = normalize_ton_address(TON_ADMIN_ADDRESS)
            dest_norm = normalize_ton_address(destination)

            if admin_norm != dest_norm:
                logger.error(f"Destination mismatch: {dest_norm} != {admin_norm}")
                return None

            if value is None:
                logger.error("Amount missing in transaction")
                return None
            try:
                value_nano = int(value)
            except (ValueError, TypeError):
                logger.error(f"Invalid amount format: {value}")
                return None

            if value_nano < expected_amount_nano:
                logger.error(f"Amount too low: {value_nano} < {expected_amount_nano}")
                return None

            target_comment = f"user:{expected_user_id}"
            if target_comment not in comment:
                logger.error(f"Comment mismatch: expected '{target_comment}', got '{comment}'")
                return None

            logger.info(f"✅ Transaction verified via TonAPI: {tx_hash} for user {expected_user_id}")
            return {"hash": tx_hash}

        except Exception as e:
            logger.error(f"TonAPI verification exception: {e}", exc_info=True)
            return None


async def verify_and_grant_premium(user_id: int, tx_hash: str) -> bool:
    """
    Idempotent premium grant. Checks if tx_hash already used.
    Returns True if premium granted (or already active with this tx), False on error.
    """
    existing = supabase.table("payments").select("id").eq("transaction_id", tx_hash).execute()
    if existing.data and len(existing.data) > 0:
        logger.info(f"Transaction {tx_hash} already processed – skipping.")
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
        except Exception:
            pass

    supabase.table("users").upsert({
        "telegram_id": user_id,
        "is_premium": True,
        "premium_expires_at": new_expiry.isoformat(),
        "updated_at": now.isoformat()
    }).execute()

    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    insert_data = {
        "telegram_id": user_id,
        "provider": "ton",
        "amount": expected_nano,
        "currency": "nanoTON",
        "payload": f"ton_{user_id}_{tx_hash[:8]}",
        "transaction_id": tx_hash,
        "status": "completed",
        "created_at": now.isoformat()
    }
    supabase.table("payments").insert(insert_data).execute()

    logger.info(f"✅ Premium granted to user {user_id} via tx {tx_hash}")
    return True


# ========== ENDPOINT: CONFIRM TON PAYMENT ==========
@router.post("/api/ton-confirm-payment")
async def confirm_payment(request: Request):
    """Receive msg_hash, verify via TonAPI, grant premium."""
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")

    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    msg_hash = body.get("msg_hash")
    if not msg_hash:
        raise HTTPException(status_code=400, detail="Missing msg_hash")

    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    tx_info = await verify_by_msg_hash(msg_hash, expected_nano, user_id)

    if not tx_info:
        raise HTTPException(status_code=400, detail="Transaction verification failed")

    tx_hash = tx_info["hash"]
    success = await verify_and_grant_premium(user_id, tx_hash)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to grant premium")

    return {"status": "completed", "message": "Premium activated"}


# ========== CONFIGURATION ENDPOINT (unchanged) ==========
@router.get("/api/ton-config")
async def ton_config():
    return {
        "adminAddress": TON_ADMIN_ADDRESS,
        "amount": TON_AMOUNT
                }
    
