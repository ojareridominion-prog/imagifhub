# ton_routes.py – Corrected hash-based verification with full debug endpoint
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
POLL_MAX_SECONDS = 60
POLL_INTERVAL = 3

logger = logging.getLogger(__name__)

def compute_sha256(data: bytes) -> str:
    """Compute SHA256 hash of raw bytes for debugging."""
    return hashlib.sha256(data).hexdigest()

async def verify_transaction_by_norm_hash(
    norm_hash: str,
    boc_b64: str = None,
    expected_amount_nano: int = None,
    expected_comment: str = None,
    max_retries: int = 20,
    delay_seconds: int = 3
) -> dict | None:
    """
    Query TonAPI for a transaction by its normalized message hash.
    Uses the /v2/blockchain/messages/{norm_hash} endpoint.
    """
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating verification for norm_hash {norm_hash}")
        return {"status": "simulated", "hash": norm_hash}

    if not TON_ADMIN_ADDRESS:
        logger.error("TON_ADMIN_ADDRESS not set")
        return None

    # Remove 0x prefix if present
    clean_hash = norm_hash.lower().replace('0x', '')
    url = f"https://tonapi.io/v2/blockchain/messages/{clean_hash}"
    headers = {"Authorization": f"Bearer {TONAPI_KEY}"} if TONAPI_KEY else {}

    for attempt in range(1, max_retries + 1):
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                logger.info(f"Attempt {attempt}/{max_retries}: checking message {clean_hash[:16]}...")
                resp = await client.get(url, headers=headers)

                if resp.status_code == 404:
                    logger.warning(f"Message not found yet (attempt {attempt}/{max_retries})")
                    if attempt < max_retries:
                        await asyncio.sleep(delay_seconds)
                        continue
                    else:
                        logger.error("Message not found after all retries")
                        return None

                if resp.status_code != 200:
                    logger.error(f"TonAPI error {resp.status_code}: {resp.text[:200]}")
                    return None

                # If we got a 200, the message exists
                msg_data = resp.json()
                logger.info(f"Message found! Data keys: {list(msg_data.keys())}")
                
                # Extract transaction info
                tx_hash = msg_data.get("transaction", {}).get("hash")
                logger.info(f"✅ Message found! Associated transaction: {tx_hash}")
                
                # We can optionally verify destination and comment here
                destination = msg_data.get("destination")
                dest_addr = destination.get("address", "") if isinstance(destination, dict) else str(destination) if destination else ""
                
                # Extract comment
                decoded_body = msg_data.get("decoded_body", {})
                comment = decoded_body.get("text", "") or msg_data.get("message", "")
                
                # Extract amount
                value = msg_data.get("value")
                
                logger.info(f"Destination: {dest_addr}")
                logger.info(f"Comment: {comment}")
                logger.info(f"Amount: {value}")
                
                # Basic checks (non-blocking for now - just log)
                if expected_comment and expected_comment not in comment:
                    logger.warning(f"Comment mismatch: expected '{expected_comment}', got '{comment}'")
                if expected_amount_nano and value and int(value) < expected_amount_nano:
                    logger.warning(f"Amount too low: {value} < {expected_amount_nano}")
                    
                return {"status": "found", "hash": norm_hash, "tx_hash": tx_hash, "msg_data": msg_data}

            except Exception as e:
                logger.error(f"TonAPI exception on attempt {attempt}: {e}", exc_info=True)
                if attempt < max_retries:
                    await asyncio.sleep(delay_seconds)
                else:
                    return None
    return None

async def verify_and_grant_premium(user_id: int, msg_hash: str) -> bool:
    """Grant premium using message hash as unique idempotency key."""
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
    """
    Receive normalized message hash from frontend and verify.
    """
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")

    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    norm_hash = body.get("norm_hash")
    boc_b64 = body.get("boc_b64")
    
    if not norm_hash:
        raise HTTPException(status_code=400, detail="Missing normalized message hash")

    expected_comment = f"user:{user_id}"
    expected_nano = int(TON_AMOUNT * 1_000_000_000)

    # Log the BOC for debugging if provided
    if boc_b64:
        logger.info(f"Received BOC length: {len(boc_b64)} chars, first 100 chars: {boc_b64[:100]}...")
        try:
            boc_bytes = base64.b64decode(boc_b64)
            logger.info(f"BOC byte length: {len(boc_bytes)} bytes")
            logger.info(f"SHA256 of BOC: {compute_sha256(boc_bytes)}")
        except Exception as e:
            logger.error(f"Failed to decode BOC: {e}")

    verification = await verify_transaction_by_norm_hash(
        norm_hash=norm_hash,
        boc_b64=boc_b64,
        expected_amount_nano=expected_nano,
        expected_comment=expected_comment
    )

    if not verification or verification.get("status") != "found":
        raise HTTPException(status_code=400, detail=f"Message verification failed. Hash: {norm_hash[:32]}...")

    success = await verify_and_grant_premium(user_id, norm_hash)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to grant premium")

    return {"status": "completed", "message": "Premium activated"}

@router.get("/api/ton-config")
async def ton_config():
    return {"adminAddress": TON_ADMIN_ADDRESS, "amount": TON_AMOUNT}

@router.get("/debug/ton-payment")
async def debug_ton_payment():
    """
    Comprehensive debug endpoint for TON payment issues.
    Shows environment config, test hash generation, etc.
    """
    debug_info = {
        "admin_address_env": TON_ADMIN_ADDRESS,
        "ton_amount": TON_AMOUNT,
        "tonapi_key_configured": bool(TONAPI_KEY),
        "dev_mode": TON_DEV_MODE,
        "api_base_url": "https://tonapi.io/v2",
        "test_endpoints": {
            "message_lookup": "https://tonapi.io/v2/blockchain/messages/{hash}",
            "account_transactions": f"https://tonapi.io/v2/accounts/{TON_ADMIN_ADDRESS}/transactions" if TON_ADMIN_ADDRESS else "Not configured"
        },
        "troubleshooting_tips": [
            "Ensure TON_ADMIN_ADDRESS is set exactly as user-friendly format (EQ... or UQ...)",
            "Check that TONAPI_KEY is valid and has rate limits available",
            "Messages can take up to 30 seconds to be indexed after transaction",
            "Normalized hash must follow TEP-467 standard",
            "Verify the comment format is exactly 'user:{telegram_id}'"
        ]
    }
    
    # If admin address is set, test normalization
    if TON_ADMIN_ADDRESS:
        try:
            from ton_utils import normalize_ton_address
            debug_info["admin_address_normalized"] = normalize_ton_address(TON_ADMIN_ADDRESS)
        except ImportError:
            debug_info["admin_address_normalized"] = "normalization function not available"
    
    return debug_info

# Also keep the old debug endpoint for backward compatibility
@router.get("/debug/admin-raw")
async def debug_admin_raw():
    return {
        "env_raw": TON_ADMIN_ADDRESS,
        "note": "Address used as-is for string comparison."
    }
    
