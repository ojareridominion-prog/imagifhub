# ton_routes.py
import os
import logging
import httpx
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase

router = APIRouter()

TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))
TON_API_KEY = os.environ.get("TON_API_KEY", "")
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"
TONCENTER_API_URL = "https://toncenter.com/api/v2"

logger = logging.getLogger(__name__)


async def verify_transaction_by_hash(tx_hash: str, expected_amount_nano: int, expected_nonce: str = None) -> tuple[bool, int]:
    """Verify transaction, optionally checking nonce in comment. Returns (success, user_id if found)"""
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Skipping real TON verification for hash {tx_hash}")
        return True, None

    if not tx_hash or not TON_ADMIN_ADDRESS:
        return False, None

    headers = {}
    if TON_API_KEY:
        headers["X-API-Key"] = TON_API_KEY

    url = f"{TONCENTER_API_URL}/getTransaction"
    params = {"hash": tx_hash}
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code != 200:
                logger.error(f"toncenter error {resp.status_code}: {resp.text}")
                return False, None

            data = resp.json()
            if not data.get("ok"):
                logger.error(f"toncenter not ok: {data}")
                return False, None

            txn = data.get("result")
            if not txn:
                logger.error(f"No transaction for hash {tx_hash}")
                return False, None

            # Extract destination
            dest = txn.get("to") or (txn.get("out_msgs", [{}])[0].get("destination"))
            if not dest or dest.lower().strip() != TON_ADMIN_ADDRESS.lower().strip():
                logger.error(f"Destination mismatch: {dest} != {TON_ADMIN_ADDRESS}")
                return False, None

            # Extract amount
            value_nano = txn.get("value") or txn.get("amount") or (txn.get("out_msgs", [{}])[0].get("value"))
            try:
                value_nano = int(value_nano)
            except:
                logger.error(f"Invalid amount: {value_nano}")
                return False, None

            if value_nano < expected_amount_nano:
                logger.error(f"Amount too low: {value_nano} < {expected_amount_nano}")
                return False, None

            # Extract comment (nonce) from messages
            comment = None
            if "in_msg" in txn and txn["in_msg"].get("msg_data", {}).get("body"):
                body = txn["in_msg"]["msg_data"]["body"]
                # Try to decode text comment (simple UTF-8)
                try:
                    if isinstance(body, str):
                        comment = body
                    elif isinstance(body, bytes):
                        comment = body.decode("utf-8", errors="ignore")
                except:
                    pass
            if expected_nonce and comment != expected_nonce:
                logger.error(f"Nonce mismatch: {comment} != {expected_nonce}")
                return False, None

            return True, None

        except Exception as e:
            logger.error(f"Verification error: {e}", exc_info=True)
            return False, None


@router.get("/api/ton-config")
async def ton_config():
    return {"adminAddress": TON_ADMIN_ADDRESS, "amount": TON_AMOUNT}


@router.post("/api/ton-init-payment")
async def init_payment(request: Request):
    """Create a pending payment with a unique nonce. Returns nonce."""
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    nonce = secrets.token_urlsafe(16)
    expiry = datetime.utcnow() + timedelta(minutes=10)

    supabase.table("pending_payments").insert({
        "user_id": user_id,
        "nonce": nonce,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat()
    }).execute()

    # Clean up old pending entries (older than 10 min)
    cleanup_time = (datetime.utcnow() - timedelta(minutes=10)).isoformat()
    supabase.table("pending_payments").delete().lt("created_at", cleanup_time).execute()

    return {"nonce": nonce}


@router.get("/api/ton-verify-payment")
async def verify_payment(tx_hash: str, nonce: str):
    """Verify transaction by hash and nonce, then grant premium."""
    if not tx_hash or not nonce:
        raise HTTPException(status_code=400, detail="Missing tx_hash or nonce")

    # Look up pending payment
    pending = supabase.table("pending_payments").select("*").eq("nonce", nonce).eq("status", "pending").execute()
    if not pending.data:
        raise HTTPException(status_code=404, detail="Invalid or expired nonce")

    pending_record = pending.data[0]
    user_id = pending_record["user_id"]
    expected_nano = int(TON_AMOUNT * 1_000_000_000)

    # Verify transaction
    valid, _ = await verify_transaction_by_hash(tx_hash, expected_nano, nonce)
    if not valid and not TON_DEV_MODE:
        raise HTTPException(status_code=400, detail="Transaction verification failed")

    # Grant premium (30 days)
    now = datetime.utcnow()
    new_expiry = now + timedelta(days=30)
    user_result = supabase.table("users").select("premium_expires_at").eq("telegram_id", user_id).execute()
    if user_result.data and user_result.data[0].get("premium_expires_at"):
        try:
            current_expiry = datetime.fromisoformat(user_result.data[0]["premium_expires_at"].replace('Z', '+00:00'))
            if current_expiry.tzinfo:
                current_expiry = current_expiry.replace(tzinfo=None)
            if current_expiry > now and current_expiry > new_expiry:
                new_expiry = current_expiry + timedelta(days=30)
        except:
            pass

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

    # Mark pending as completed
    supabase.table("pending_payments").update({"status": "completed", "tx_hash": tx_hash}).eq("nonce", nonce).execute()

    logger.info(f"✅ TON payment verified for user {user_id}, tx_hash {tx_hash}")
    return {"status": "completed", "message": "Premium activated"}


# Keep old endpoints for compatibility (but marked deprecated)
@router.get("/api/ton-check-tx")
async def check_transaction_deprecated(request: Request):
    """Deprecated – use /api/ton-verify-payment instead"""
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    # For backward compatibility, still allow but redirect logic
    raise HTTPException(status_code=410, detail="Endpoint moved. Use /api/ton-verify-payment with nonce")

@router.post("/api/ton-verify-boc")
async def verify_boc_deprecated():
    raise HTTPException(status_code=410, detail="BOC verification no longer supported. Use /api/ton-verify-payment")
    
