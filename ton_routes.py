# ton_routes.py - Full working version with robust BOC decoding
import os
import json
import base64
import logging
import httpx
from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timedelta
from utils import get_user_id_from_init_data
from config import supabase

router = APIRouter()

# ========== ENVIRONMENT VARIABLES ==========
TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
# Support both variable names – TON_PAYMENT_AMOUNT takes precedence
TON_AMOUNT = float(os.environ.get("TON_PAYMENT_AMOUNT", os.environ.get("TON_AMOUNT", "1.12")))
TON_API_KEY = os.environ.get("TON_API_KEY", "")
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"

TONCENTER_API_URL = "https://toncenter.com/api/v2"
logger = logging.getLogger(__name__)


# ========== HELPER: VERIFY TRANSACTION BY HASH (TONCENTER) ==========
async def verify_transaction_by_hash(tx_hash: str, expected_amount_nano: int) -> bool:
    """Check transaction destination and amount using toncenter."""
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Skipping verification for hash {tx_hash}")
        return True

    if not tx_hash or not TON_ADMIN_ADDRESS:
        logger.error("Missing tx_hash or admin address")
        return False

    headers = {"X-API-Key": TON_API_KEY} if TON_API_KEY else {}
    url = f"{TONCENTER_API_URL}/getTransaction"
    params = {"hash": tx_hash}

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code != 200:
                logger.error(f"toncenter error {resp.status_code}: {resp.text[:200]}")
                return False

            data = resp.json()
            if not data.get("ok"):
                logger.error(f"toncenter not ok: {data}")
                return False

            txn = data.get("result")
            if not txn:
                logger.error(f"No transaction found for hash {tx_hash}")
                return False

            # Extract destination address
            dest = txn.get("to") or (txn.get("out_msgs", [{}])[0].get("destination"))
            if not dest or dest.lower() != TON_ADMIN_ADDRESS.lower():
                logger.error(f"Destination mismatch: {dest} != {TON_ADMIN_ADDRESS}")
                return False

            # Extract amount in nanoTON
            value_nano = txn.get("value") or txn.get("amount") or txn.get("out_msgs", [{}])[0].get("value")
            if value_nano is None:
                logger.error("No amount found in transaction")
                return False

            value_nano = int(value_nano)
            if value_nano < expected_amount_nano:
                logger.error(f"Amount too low: {value_nano} < {expected_amount_nano}")
                return False

            logger.info(f"Transaction {tx_hash} verified successfully")
            return True

        except Exception as e:
            logger.error(f"Verification exception: {e}", exc_info=True)
            return False


# ========== HELPER: DECODE BOC (TONAPI.IO FIRST, THEN TONCENTER) ==========
async def decode_boc(boc: str) -> str | None:
    """
    Convert a BOC (base64 string) into a transaction hash.
    Uses tonapi.io (free, reliable) first; falls back to toncenter.
    """
    # 1. Try tonapi.io (no API key required)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://tonapi.io/v1/blockchain/getTransaction",
                json={"boc": boc}
            )
            if resp.status_code == 200:
                data = resp.json()
                tx_hash = data.get("hash") or data.get("transaction", {}).get("hash")
                if tx_hash:
                    logger.info(f"Decoded BOC using tonapi.io: {tx_hash}")
                    return tx_hash
                else:
                    logger.warning(f"tonapi.io response missing hash: {data}")
    except Exception as e:
        logger.warning(f"tonapi.io decode failed: {e}")

    # 2. Fallback to toncenter /decodeBoc
    headers = {"X-API-Key": TON_API_KEY} if TON_API_KEY else {}
    url = f"{TONCENTER_API_URL}/decodeBoc"

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            # Attempt A: send as raw bytes
            boc_bytes = base64.b64decode(boc)
            resp = await client.post(url, content=boc_bytes, headers=headers)
            if resp.status_code != 200:
                # Attempt B: send as JSON string
                resp = await client.post(url, json={"boc": boc}, headers=headers)

            if resp.status_code != 200:
                logger.error(f"toncenter decodeBoc HTTP {resp.status_code}: {resp.text[:200]}")
                return None

            data = resp.json()
            if data.get("ok") and data.get("result"):
                result = data["result"]
                if isinstance(result, dict) and "hash" in result:
                    return result["hash"]
                if isinstance(result, list) and len(result) > 0 and "hash" in result[0]:
                    return result[0]["hash"]

            logger.error(f"Unexpected decodeBoc response: {json.dumps(data)[:200]}")
            return None

        except Exception as e:
            logger.error(f"toncenter decodeBoc exception: {e}", exc_info=True)
            return None


# ========== INTERNAL: GRANT PREMIUM & RECORD PAYMENT ==========
async def _grant_premium(user_id: int, tx_hash: str):
    """Activate premium for 30 days and log payment."""
    now = datetime.utcnow()
    new_expiry = now + timedelta(days=30)

    # Extend existing premium if longer
    user_result = supabase.table("users").select("premium_expires_at").eq("telegram_id", user_id).execute()
    if user_result.data and user_result.data[0].get("premium_expires_at"):
        current_str = user_result.data[0]["premium_expires_at"]
        try:
            if current_str.endswith('Z'):
                current_str = current_str.replace('Z', '+00:00')
            current_exp = datetime.fromisoformat(current_str)
            if current_exp.tzinfo:
                current_exp = current_exp.replace(tzinfo=None)
            if current_exp > now and current_exp > new_expiry:
                new_expiry = current_exp + timedelta(days=30)
                logger.info(f"Extending premium for user {user_id} to {new_expiry}")
        except Exception as e:
            logger.warning(f"Could not parse existing expiry: {e}")

    # Upsert user
    supabase.table("users").upsert({
        "telegram_id": user_id,
        "is_premium": True,
        "premium_expires_at": new_expiry.isoformat(),
        "updated_at": now.isoformat()
    }).execute()

    # Record payment
    supabase.table("payments").insert({
        "telegram_id": user_id,
        "provider": "ton",
        "amount": TON_AMOUNT,
        "currency": "TON",
        "payload": f"ton_{user_id}_{tx_hash[:8]}",
        "transaction_id": tx_hash,
        "status": "completed",
        "created_at": now.isoformat()
    }).execute()

    logger.info(f"✅ Premium granted to user {user_id} via TON, tx {tx_hash}")
    return {"status": "completed", "message": "Premium activated"}


# ========== ENDPOINTS ==========

@router.get("/api/ton-config")
async def ton_config():
    """Return admin wallet address and required TON amount."""
    return {
        "adminAddress": TON_ADMIN_ADDRESS,
        "amount": TON_AMOUNT
    }


@router.get("/api/ton-check-tx")
async def check_transaction(request: Request):
    """Verify a direct transaction hash and grant premium."""
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    tx_hash = request.query_params.get("tx_hash")
    if not tx_hash:
        raise HTTPException(status_code=400, detail="Missing tx_hash")

    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    valid = await verify_transaction_by_hash(tx_hash, expected_nano)
    if not valid and not TON_DEV_MODE:
        raise HTTPException(status_code=400, detail="Transaction verification failed")

    return await _grant_premium(user_id, tx_hash)


@router.post("/api/ton-verify-boc")
async def verify_boc(request: Request):
    """Decode a BOC, verify the transaction, and grant premium."""
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    boc = body.get("boc")
    if not boc:
        raise HTTPException(status_code=400, detail="Missing boc")

    # DEV MODE: skip all verification
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] BOC received, granting premium without verification")
        return await _grant_premium(user_id, "dev_boc")

    # Production: decode BOC and verify
    tx_hash = await decode_boc(boc)
    if not tx_hash:
        logger.error("Failed to extract hash from BOC")
        raise HTTPException(status_code=400, detail="Could not decode BOC. Please try again or use a different wallet.")

    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    valid = await verify_transaction_by_hash(tx_hash, expected_nano)
    if not valid:
        raise HTTPException(status_code=400, detail="Transaction verification failed")

    return await _grant_premium(user_id, tx_hash)
    
