# ton_routes.py – Transaction hash verification (no polling, no retry loops)
import os
import logging
import httpx
import base64
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase
from datetime import datetime, timedelta

router = APIRouter()

TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "").strip()
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"
TONAPI_KEY = os.environ.get("TONAPI_KEY", "")

logger = logging.getLogger(__name__)

def normalize_ton_address(address: str) -> str:
    """Convert user-friendly EQ/UQ address to raw hex format (0:...) for TonAPI."""
    if address.startswith("0:"):
        return address
    # Very simple raw extraction – assumes the address is already in raw form
    # For production, use a proper library (ton, tonsdk) to decode base64 user-friendly.
    # Here we just check if it's already raw. If not, log a warning.
    if address.startswith("EQ") or address.startswith("UQ"):
        logger.warning(f"Address {address} is user-friendly, but TonAPI expects raw. Please set TON_ADMIN_ADDRESS to raw format (0:...).")
    return address  # fallback

async def verify_transaction_by_hash(
    tx_hash: str,
    expected_admin: str,
    expected_user_id: int,
    expected_amount_nano: int
) -> dict | None:
    """
    Verify a single transaction by its hash using TonAPI.
    Returns transaction details if matches, None otherwise.
    """
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating verification for tx_hash {tx_hash}")
        return {"status": "simulated"}

    if not expected_admin:
        logger.error("TON_ADMIN_ADDRESS not set")
        return None

    # Remove 0x prefix and ensure lowercase
    clean_hash = tx_hash.lower().replace('0x', '')
    url = f"https://tonapi.io/v2/blockchain/transactions/{clean_hash}"
    headers = {"Authorization": f"Bearer {TONAPI_KEY}"} if TONAPI_KEY else {}

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            logger.info(f"Checking transaction {clean_hash[:16]}...")
            resp = await client.get(url, headers=headers)

            if resp.status_code != 200:
                logger.error(f"TonAPI error {resp.status_code}: {resp.text[:200]}")
                return None

            tx_data = resp.json()
            logger.info(f"Transaction found! Hash: {tx_data.get('hash')}")

            # Normalize admin address for comparison
            raw_admin = normalize_ton_address(expected_admin)

            out_msgs = tx_data.get("out_msgs", [])
            expected_comment = f"user:{expected_user_id}"

            for msg in out_msgs:
                destination = msg.get("destination", {}).get("address", "")
                if destination != raw_admin and destination != expected_admin:
                    continue

                value = int(msg.get("value", 0))
                if value < expected_amount_nano:
                    continue

                decoded_body = msg.get("decoded_body", {})
                comment = decoded_body.get("text", "")
                if expected_comment in comment:
                    logger.info(f"✅ Transaction {clean_hash} verified for user {expected_user_id}")
                    return {"status": "found", "tx_hash": clean_hash, "msg_data": msg}

            logger.warning(f"Transaction {clean_hash} does not match expected recipient/amount/comment")
            return None

        except Exception as e:
            logger.error(f"Transaction lookup failed: {e}", exc_info=True)
            return None

async def verify_and_grant_premium(user_id: int, tx_hash: str) -> bool:
    existing = supabase.table("payments").select("id").eq("transaction_id", tx_hash).execute()
    if existing.data:
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
        "payload": f"ton_{user_id}_{tx_hash[:8]}",
        "transaction_id": tx_hash,
        "status": "completed",
        "created_at": now.isoformat()
    }).execute()

    logger.info(f"✅ Premium granted to user {user_id} via transaction {tx_hash}")
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
    tx_hash = body.get("transaction_hash")
    boc_b64 = body.get("boc_b64")

    if not tx_hash:
        raise HTTPException(status_code=400, detail="Missing transaction hash")

    expected_amount_nano = int(TON_AMOUNT * 1_000_000_000)

    # Optional: log BOC length for debugging
    if boc_b64:
        logger.info(f"Received BOC length: {len(boc_b64)} chars (not used in verification)")

    # Single verification attempt – no retries
    verification = await verify_transaction_by_hash(
        tx_hash=tx_hash,
        expected_admin=TON_ADMIN_ADDRESS,
        expected_user_id=user_id,
        expected_amount_nano=expected_amount_nano
    )

    if not verification or verification.get("status") != "found":
        raise HTTPException(status_code=400, detail="Payment verification failed – transaction not found or invalid")

    success = await verify_and_grant_premium(user_id, tx_hash)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to grant premium")

    return {"status": "completed", "message": "Premium activated"}

@router.get("/api/ton-config")
async def ton_config():
    return {"adminAddress": TON_ADMIN_ADDRESS, "amount": TON_AMOUNT}

@router.get("/debug/ton-payment")
async def debug_ton_payment():
    return {
        "admin_address_env": TON_ADMIN_ADDRESS,
        "admin_address_raw_suggestion": "Convert your admin address to raw format (0:...) for reliable comparison",
        "ton_amount": TON_AMOUNT,
        "tonapi_key_configured": bool(TONAPI_KEY),
        "dev_mode": TON_DEV_MODE,
        "api_base_url": "https://tonapi.io/v2",
        "test_endpoints": {
            "transaction_lookup": "https://tonapi.io/v2/blockchain/transactions/{hash}",
        },
        "troubleshooting_tips": [
            "Set TON_ADMIN_ADDRESS to RAW format (starts with 0:) – you can convert using https://ton.org/address",
            "Ensure TONAPI_KEY is valid",
            "Transaction hash must be lowercase hex without 0x",
            "Wait 5-10 seconds after payment before verifying"
        ]
    }

@router.get("/debug/admin-raw")
async def debug_admin_raw():
    return {
        "env_raw": TON_ADMIN_ADDRESS,
        "note": "Address used as-is for string comparison."
        }
    
