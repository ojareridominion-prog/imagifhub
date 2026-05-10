# ton_routes.py
import os
import asyncio
import logging
import httpx
import base64
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase
from datetime import datetime, timedelta

from tonsdk.boc import Cell
import hashlib

router = APIRouter()

# ========== ENVIRONMENT VARIABLES ==========
TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))          # in TON
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"
TONAPI_KEY = os.environ.get("TONAPI_KEY", "")

logger = logging.getLogger(__name__)


# ========== ADDRESS NORMALIZATION ==========
def normalize_ton_address(addr: str) -> str:
    """Convert any TON address to raw hex (without 0: prefix)."""
    addr = addr.strip()
    if not addr:
        return ""
    if len(addr) == 64 and all(c in "0123456789abcdefABCDEF" for c in addr):
        return addr.lower()
    if addr.startswith("0:"):
        return addr[2:].lower()
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
    return addr.lower()


# ========== DECODE BOC AND EXTRACT INTERNAL MESSAGE HASH ==========
def internal_msg_hash_from_boc(boc_base64: str) -> str | None:
    """
    Decode the BOC (base64) of the signed external message,
    extract the internal message cell, compute its SHA256 hash.
    """
    try:
        boc_bytes = base64.b64decode(boc_base64)
        # Deserialize the root cell (external message)
        root_cell = Cell.one_from_boc(boc_bytes)
        
        # The external message has a reference to the internal message cell
        if not root_cell.refs:
            logger.error("No references in external message cell")
            return None
        
        internal_cell = root_cell.refs[0]
        # Compute hash of the internal message cell
        # The hash is SHA256 of the cell's representation (including its data and references)
        # Using cell.hash property (most reliable)
        if hasattr(internal_cell, 'hash'):
            msg_hash = internal_cell.hash.hex()
        else:
            # Fallback: serialize and hash
            internal_bytes = internal_cell.serialize()
            msg_hash = hashlib.sha256(internal_bytes).hexdigest()
        
        logger.info(f"Computed internal message hash: {msg_hash}")
        return msg_hash
    except Exception as e:
        logger.error(f"Failed to decode BOC: {e}", exc_info=True)
        return None


# ========== VERIFY TRANSACTION VIA INTERNAL MESSAGE HASH ==========
async def verify_by_internal_msg_hash(
    internal_msg_hash: str,
    expected_amount_nano: int,
    expected_user_id: int
) -> dict | None:
    """Call TonAPI /by_message_hash with the correct internal message hash."""
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating verification for hash {internal_msg_hash}")
        return {"hash": "dev_tx_hash"}

    await asyncio.sleep(3)  # allow time for indexing

    clean_hash = internal_msg_hash.lower().replace('0x', '')
    url = f"https://tonapi.io/v2/blockchain/transactions/by_message_hash/{clean_hash}"
    headers = {"Authorization": f"Bearer {TONAPI_KEY}"} if TONAPI_KEY else {}

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                logger.error(f"TonAPI error {resp.status_code}: {resp.text[:200]}")
                return None

            tx = resp.json()
            tx_hash = tx.get("hash")
            if not tx_hash:
                logger.error("No transaction hash in response")
                return None

            # Verify details
            in_msgs = tx.get("in_msgs", [])
            if not in_msgs:
                logger.error("No in_msgs in transaction")
                return None
            in_msg = in_msgs[0]
            destination = in_msg.get("destination", "")
            value = in_msg.get("value")
            comment = in_msg.get("message", "")

            admin_norm = normalize_ton_address(TON_ADMIN_ADDRESS)
            dest_norm = normalize_ton_address(destination)
            if admin_norm != dest_norm:
                logger.error(f"Destination mismatch: {dest_norm} != {admin_norm}")
                return None

            try:
                value_nano = int(value)
            except (ValueError, TypeError):
                logger.error(f"Invalid amount: {value}")
                return None

            if value_nano < expected_amount_nano:
                logger.error(f"Amount too low: {value_nano} < {expected_amount_nano}")
                return None

            if f"user:{expected_user_id}" not in comment:
                logger.error(f"Comment mismatch: expected 'user:{expected_user_id}', got '{comment}'")
                return None

            logger.info(f"✅ Transaction verified: {tx_hash}")
            return {"hash": tx_hash}

        except Exception as e:
            logger.error(f"TonAPI verification error: {e}", exc_info=True)
            return None


# ========== IDEMPOTENT PREMIUM GRANT ==========
async def verify_and_grant_premium(user_id: int, tx_hash: str) -> bool:
    existing = supabase.table("payments").select("id").eq("transaction_id", tx_hash).execute()
    if existing.data and len(existing.data) > 0:
        logger.info(f"Transaction {tx_hash} already processed.")
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

    logger.info(f"✅ Premium granted to user {user_id}")
    return True


# ========== ENDPOINT: CONFIRM TON PAYMENT ==========
@router.post("/api/ton-confirm-payment")
async def confirm_payment(request: Request):
    """Receive BOC, extract internal message hash, verify via TonAPI."""
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")

    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    boc_base64 = body.get("boc")
    if not boc_base64:
        raise HTTPException(status_code=400, detail="Missing boc field")

    # 1. Compute internal message hash from BOC
    internal_msg_hash = internal_msg_hash_from_boc(boc_base64)
    if not internal_msg_hash:
        raise HTTPException(status_code=400, detail="Failed to decode BOC or extract internal message")

    logger.info(f"Computed internal message hash: {internal_msg_hash}")

    expected_nano = int(TON_AMOUNT * 1_000_000_000)

    # 2. Verify via TonAPI
    tx_info = await verify_by_internal_msg_hash(internal_msg_hash, expected_nano, user_id)
    if not tx_info:
        raise HTTPException(status_code=400, detail="Transaction verification failed")

    tx_hash = tx_info["hash"]
    success = await verify_and_grant_premium(user_id, tx_hash)
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
    
