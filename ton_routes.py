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
TONAPI_KEY = os.environ.get("TONAPI_KEY", "")                     # optional

logger = logging.getLogger(__name__)


# ========== ADDRESS NORMALIZATION ==========
def normalize_ton_address(addr: str) -> str:
    """
    Convert any TON address to its raw hex representation (without 0: prefix).
    """
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
            return decoded[1:].hex()
        except Exception:
            pass
    return addr.lower()


# ========== VERIFY USING TonAPI (with endpoint candidates) ==========
async def verify_by_msg_hash(msg_hash: str, expected_amount_nano: int, expected_user_id: int) -> dict | None:
    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating verification for msg_hash {msg_hash}")
        return {"hash": "dev_tx_hash"}

    if not TON_ADMIN_ADDRESS:
        logger.error("TON_ADMIN_ADDRESS not set")
        return None

    # Clean hash (remove 0x prefix)
    clean_hash = msg_hash.lower().replace('0x', '')
    # Possible endpoint patterns (TonAPI v2)
    endpoints = [
        f"https://tonapi.io/v2/blockchain/transactions/by_message_hash/{clean_hash}",
        f"https://tonapi.io/v2/transactions/byMessageHash?hash={clean_hash}",
        f"https://tonapi.io/v2/transactions/by_message_hash/{clean_hash}",
    ]

    headers = {}
    if TONAPI_KEY:
        headers["Authorization"] = f"Bearer {TONAPI_KEY}"

    async with httpx.AsyncClient(timeout=15.0) as client:
        for url in endpoints:
            try:
                logger.info(f"Trying TonAPI: {url}")
                resp = await client.get(url, headers=headers)
                logger.info(f"Response status: {resp.status_code}")

                if resp.status_code == 200:
                    data = resp.json()
                    # The response structure may vary – we extract what we need
                    # Some endpoints return a list with 'transactions', others a single object
                    if isinstance(data, dict) and "transactions" in data:
                        tx_list = data["transactions"]
                        if not tx_list:
                            continue
                        tx = tx_list[0]
                    else:
                        tx = data  # assume single transaction object

                    tx_hash = tx.get("hash")
                    if not tx_hash:
                        logger.warning("No 'hash' field in response")
                        continue

                    out_msgs = tx.get("out_msgs", [])
                    if not out_msgs:
                        logger.warning("No 'out_msgs' in transaction")
                        continue

                    msg = out_msgs[0]
                    destination = msg.get("destination", "")
                    value = msg.get("value")
                    comment = msg.get("message", "")

                    admin_norm = normalize_ton_address(TON_ADMIN_ADDRESS)
                    dest_norm = normalize_ton_address(destination)

                    if admin_norm != dest_norm:
                        logger.error(f"Destination mismatch: {dest_norm} != {admin_norm}")
                        continue

                    if value is None:
                        logger.error("Amount missing")
                        continue

                    try:
                        value_nano = int(value)
                    except (ValueError, TypeError):
                        logger.error(f"Invalid amount format: {value}")
                        continue

                    if value_nano < expected_amount_nano:
                        logger.error(f"Amount too low: {value_nano} < {expected_amount_nano}")
                        continue

                    target_comment = f"user:{expected_user_id}"
                    if target_comment not in comment:
                        logger.error(f"Comment mismatch: expected '{target_comment}', got '{comment}'")
                        continue

                    logger.info(f"✅ Verified via {url} – tx_hash={tx_hash}")
                    return {"hash": tx_hash}

                elif resp.status_code == 404:
                    # hash not found, try next endpoint
                    continue
                else:
                    logger.warning(f"Unexpected status {resp.status_code} from {url}: {resp.text[:200]}")
                    continue

            except Exception as e:
                logger.error(f"Exception for {url}: {e}")
                continue

        logger.error("All TonAPI endpoints failed to verify the transaction")
        return None


async def verify_and_grant_premium(user_id: int, tx_hash: str) -> bool:
    # Idempotent check
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

    logger.info(f"✅ Premium granted to user {user_id} via tx {tx_hash}")
    return True


# ========== ENDPOINT ==========
@router.post("/api/ton-confirm-payment")
async def confirm_payment(request: Request):
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


@router.get("/api/ton-config")
async def ton_config():
    return {
        "adminAddress": TON_ADMIN_ADDRESS,
        "amount": TON_AMOUNT
                    }
    
