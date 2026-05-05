# ton_routes.py
import os
import logging
import httpx
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase
from datetime import datetime, timedelta

router = APIRouter()

# ========== ENVIRONMENT VARIABLES ==========
TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))          # in TON
TON_API_KEY = os.environ.get("TON_API_KEY", "")                   # optional for toncenter
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"

# toncenter endpoints (mainnet)
TONCENTER_API_URL = "https://toncenter.com/api/v2"
# For testnet you could use: "https://testnet.toncenter.com/api/v2"
# We assume mainnet here.

logger = logging.getLogger(__name__)


# ========== HELPER: VERIFY TRANSACTION VIA TONCENTER ==========
async def verify_transaction_by_hash(tx_hash: str, expected_amount_nano: int) -> bool:
    """
    Call toncenter's getTransaction method and verify:
    - Transaction exists
    - Destination matches TON_ADMIN_ADDRESS
    - Amount >= expected_amount_nano
    """
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Skipping real TON verification for hash {tx_hash}")
        return True

    if not tx_hash:
        logger.error("No transaction hash provided")
        return False

    if not TON_ADMIN_ADDRESS:
        logger.error("TON_ADMIN_ADDRESS not set")
        return False

    headers = {}
    if TON_API_KEY:
        headers["X-API-Key"] = TON_API_KEY

    # toncenter endpoint to get a single transaction
    url = f"{TONCENTER_API_URL}/getTransaction"
    params = {"hash": tx_hash, "shardblock": None}  # shardblock can be omitted

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code != 200:
                logger.error(f"toncenter error {resp.status_code}: {resp.text}")
                return False

            data = resp.json()
            if not data.get("ok"):
                logger.error(f"toncenter returned not ok: {data}")
                return False

            txn = data.get("result")
            if not txn:
                logger.error(f"No transaction found for hash {tx_hash}")
                return False

            # Extract destination address (usually the 'to' field)
            dest = txn.get("to")
            if not dest:
                # Sometimes the 'out_msgs' array contains the destination
                out_msgs = txn.get("out_msgs", [])
                if out_msgs and len(out_msgs) > 0:
                    dest = out_msgs[0].get("destination")
            if not dest:
                logger.error("Could not extract destination address from transaction")
                return False

            # Compare addresses (case‑insensitive, strip any protocol prefix)
            admin_raw = TON_ADMIN_ADDRESS.lower().strip()
            dest_raw = dest.lower().strip()
            if admin_raw != dest_raw:
                logger.error(f"Destination mismatch: {dest_raw} != {admin_raw}")
                return False

            # Extract amount in nanoTON (1 TON = 1e9 nano)
            # The field can be 'value' or 'amount'
            value_nano = txn.get("value")
            if value_nano is None:
                value_nano = txn.get("amount")
            if value_nano is None:
                # Fallback: look in out_msgs
                out_msgs = txn.get("out_msgs", [])
                if out_msgs and len(out_msgs) > 0:
                    value_nano = out_msgs[0].get("value")
            if value_nano is None:
                logger.error("Could not extract amount from transaction")
                return False

            try:
                value_nano = int(value_nano)
            except (ValueError, TypeError):
                logger.error(f"Invalid amount format: {value_nano}")
                return False

            if value_nano < expected_amount_nano:
                logger.error(f"Amount too low: {value_nano} < {expected_amount_nano}")
                return False

            return True

        except Exception as e:
            logger.error(f"Exception verifying transaction: {e}", exc_info=True)
            return False


# ========== ENDPOINTS ==========

@router.get("/api/ton-config")
async def ton_config():
    """Return the admin wallet address and the required amount (in TON)."""
    return {
        "adminAddress": TON_ADMIN_ADDRESS,
        "amount": TON_AMOUNT
    }


@router.get("/api/ton-check-tx")
async def check_transaction(request: Request):
    """
    Verify a TON payment by transaction hash.
    Query parameter: ?tx_hash=<hash>
    On success, grant premium (30 days) to the user.
    """
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

    # Verify transaction
    valid = await verify_transaction_by_hash(tx_hash, expected_nano)
    if not valid:
        # For development mode, if we skip verification we still grant premium
        if not TON_DEV_MODE:
            raise HTTPException(status_code=400, detail="Transaction verification failed")

    # ========== GRANT PREMIUM (30 days) ==========
    now = datetime.utcnow()
    new_expiry = now + timedelta(days=30)

    # Fetch existing expiry to extend if already premium
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
            logger.warning(f"Could not parse existing expiry: {e}")

    # Upsert user premium
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

    logger.info(f"✅ TON payment verified for user {user_id}, tx_hash {tx_hash}")
    return {"status": "completed", "message": "Premium activated"}


@router.post("/api/ton-verify-boc")
async def verify_boc(request: Request):
    """
    Alternative verification: accept a BOC (bag of cells) from the wallet,
    decode it to extract transaction hash, then verify via toncenter.
    This is used as a fallback in tonPayment.js when no direct hash is returned.
    """
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

    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] BOC verification skipped for user {user_id}")
        # Grant premium directly
        return await _grant_premium(user_id, "dev_boc")

    try:
        # Use toncenter's /sendBocReturnHash or decode BOC locally.
        # Since decoding BOC on the server is complex, we ask toncenter to decode.
        async with httpx.AsyncClient(timeout=15.0) as client:
            # First, try to decode BOC and get the transaction hash.
            # toncenter provides /decodeBoc endpoint (if available)
            decode_url = f"{TONCENTER_API_URL}/decodeBoc"
            decode_resp = await client.post(decode_url, json={"boc": boc})
            if decode_resp.status_code != 200:
                logger.error(f"Failed to decode BOC: {decode_resp.text}")
                raise HTTPException(status_code=400, detail="Invalid BOC")

            decode_data = decode_resp.json()
            # The response structure may vary – find the first transaction hash
            tx_hash = None
            if "hash" in decode_data:
                tx_hash = decode_data["hash"]
            elif "transactions" in decode_data and len(decode_data["transactions"]) > 0:
                tx_hash = decode_data["transactions"][0].get("hash")
            if not tx_hash:
                raise HTTPException(status_code=400, detail="Could not extract tx hash from BOC")

        # Now verify the extracted hash
        expected_nano = int(TON_AMOUNT * 1_000_000_000)
        verified = await verify_transaction_by_hash(tx_hash, expected_nano)
        if not verified:
            raise HTTPException(status_code=400, detail="Transaction verification failed")

        # Grant premium
        return await _grant_premium(user_id, tx_hash)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"BOC verification error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


# Internal helper to grant premium and record payment
async def _grant_premium(user_id: int, tx_hash: str):
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

    return {"status": "completed", "message": "Premium activated"}
    
