# ton_routes.py – User-wallet polling (no admin wallet)
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

TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "").strip()
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"
TONAPI_KEY = os.environ.get("TONAPI_KEY", "")
POLL_MAX_SECONDS = 60
POLL_INTERVAL = 3

logger = logging.getLogger(__name__)

def get_raw_address(address: str) -> str:
    """
    Convert a user‑friendly TON address (EQ/UQ) to raw format (workchain:hex).
    Used to compare addresses returned by TonAPI.
    """
    if ":" in address:
        return address
    try:
        # Base64 decode the user‑friendly address
        b64_padded = address.replace('-', '+').replace('_', '/')
        b64_padded += "=" * ((4 - len(b64_padded) % 4) % 4)
        decoded = base64.b64decode(b64_padded)
        workchain = int.from_bytes(decoded[1:2], byteorder="big", signed=True)
        hash_part = decoded[2:34].hex()
        return f"{workchain}:{hash_part}"
    except Exception as e:
        logger.error(f"Failed to parse address {address}: {e}")
        return address  # fallback to original

async def verify_transaction_via_sender(
    sender_address: str,
    expected_amount_nano: int,
    expected_comment: str,
    max_retries: int = 20,
    delay_seconds: int = 3
) -> dict | None:
    """
    Poll the sender's wallet for recent outgoing transactions.
    Returns the transaction hash if a matching payment is found.
    """
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating verification for sender {sender_address}")
        return {"status": "found", "hash": "dev_simulated_hash"}

    if not TON_ADMIN_ADDRESS:
        logger.error("TON_ADMIN_ADDRESS not set")
        return None

    # Convert admin address to raw format for reliable comparison
    raw_admin = get_raw_address(TON_ADMIN_ADDRESS)
    # Also keep the user‑friendly version (some endpoints return one or the other)
    friendly_admin = TON_ADMIN_ADDRESS

    # Use the sender address as‑is (already in raw format from TonConnect)
    url = f"https://tonapi.io/v2/accounts/{sender_address}/transactions?limit=10"
    headers = {"Authorization": f"Bearer {TONAPI_KEY}"} if TONAPI_KEY else {}

    for attempt in range(1, max_retries + 1):
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                logger.info(f"Attempt {attempt}/{max_retries}: checking sender wallet {sender_address[:8]}...")
                resp = await client.get(url, headers=headers)

                if resp.status_code != 200:
                    logger.warning(f"TonAPI error {resp.status_code}: {resp.text[:200]}")
                    if attempt < max_retries:
                        await asyncio.sleep(delay_seconds)
                        continue
                    else:
                        return None

                data = resp.json()
                transactions = data.get("transactions", [])

                for tx in transactions:
                    out_msgs = tx.get("out_msgs", [])
                    for msg in out_msgs:
                        dest_obj = msg.get("destination", {})
                        dest_addr = dest_obj.get("address", "") if isinstance(dest_obj, dict) else str(dest_obj)

                        # Compare destination (both raw and friendly)
                        if dest_addr not in (raw_admin, friendly_admin):
                            continue

                        value = int(msg.get("value", 0))
                        if value < expected_amount_nano:
                            continue

                        decoded_body = msg.get("decoded_body", {})
                        comment = decoded_body.get("text", "") or msg.get("message", "")

                        if expected_comment in comment:
                            tx_hash = tx.get("hash")
                            logger.info(f"✅ Matching transaction found: {tx_hash}")
                            return {"status": "found", "hash": tx_hash}

                logger.info(f"No matching transaction yet (attempt {attempt}/{max_retries})")
                if attempt < max_retries:
                    await asyncio.sleep(delay_seconds)

            except Exception as e:
                logger.error(f"Polling attempt {attempt} failed: {e}", exc_info=True)
                if attempt < max_retries:
                    await asyncio.sleep(delay_seconds)
                else:
                    return None
    return None

async def verify_and_grant_premium(user_id: int, tx_hash: str) -> bool:
    """Grant premium using transaction hash as unique idempotency key."""
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
    """
    Receive sender wallet address from frontend, poll user's transactions,
    and grant premium if the expected payment is found.
    """
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")

    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    sender_address = body.get("sender_address")
    boc_b64 = body.get("boc_b64")   # kept for logging, not used in verification

    if not sender_address:
        raise HTTPException(status_code=400, detail="Missing sender wallet address")

    expected_comment = f"user:{user_id}"
    expected_nano = int(TON_AMOUNT * 1_000_000_000)

    if boc_b64:
        logger.info(f"Received BOC (length {len(boc_b64)} chars) – not used for verification")

    # Poll the sender's wallet
    verification = await verify_transaction_via_sender(
        sender_address=sender_address,
        expected_amount_nano=expected_nano,
        expected_comment=expected_comment
    )

    if not verification or verification.get("status") != "found":
        raise HTTPException(status_code=400, detail="Payment verification failed – transaction not found in sender's wallet")

    actual_tx_hash = verification.get("hash")
    success = await verify_and_grant_premium(user_id, actual_tx_hash)
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
    Shows environment config.
    """
    debug_info = {
        "admin_address_env": TON_ADMIN_ADDRESS,
        "ton_amount": TON_AMOUNT,
        "tonapi_key_configured": bool(TONAPI_KEY),
        "dev_mode": TON_DEV_MODE,
        "api_base_url": "https://tonapi.io/v2",
        "test_endpoints": {
            "user_transactions": "https://tonapi.io/v2/accounts/{user_address}/transactions",
        },
        "troubleshooting_tips": [
            "Ensure TON_ADMIN_ADDRESS is set exactly as user-friendly format (EQ... or UQ...)",
            "Check that TONAPI_KEY is valid and has rate limits available",
            "Transactions appear on TonAPI within a few seconds after being mined",
            "The frontend now sends the user's wallet address; we poll that wallet's recent transactions",
            "Comment format must be exactly 'user:{telegram_id}'"
        ]
    }
    return debug_info

@router.get("/debug/admin-raw")
async def debug_admin_raw():
    return {
        "env_raw": TON_ADMIN_ADDRESS,
        "raw_format": get_raw_address(TON_ADMIN_ADDRESS) if TON_ADMIN_ADDRESS else None,
        "note": "Address used as-is for string comparison."
        }
    
