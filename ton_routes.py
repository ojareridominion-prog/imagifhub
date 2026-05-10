# ton_routes.py – Poll user wallet (sender) using TonAPI
import os
import asyncio
import logging
import httpx
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase
from datetime import datetime, timedelta

router = APIRouter()

# ========== ENVIRONMENT VARIABLES ==========
TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "").strip()
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))          # in TON
TON_API_KEY = os.environ.get("TON_API_KEY", "")                   # required for TonAPI
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"

# Polling settings
POLL_MAX_SECONDS = 45
POLL_INTERVAL = 3

logger = logging.getLogger(__name__)


# ========== ADDRESS NORMALIZATION (for TonAPI raw format) ==========
def to_raw_ton_address(addr: str) -> str:
    """
    Convert any TON address to raw hex format (0:XXXXXXXX...).
    TonAPI accepts raw format like "0:83f0...".
    """
    addr = addr.strip()
    if not addr:
        return ""

    # Already raw address with 0: prefix
    if addr.startswith("0:"):
        return addr.lower()

    # User‑friendly format (EQ... or UQ...)
    if addr.startswith("EQ") or addr.startswith("UQ"):
        import base64
        b64 = addr[2:].replace('-', '+').replace('_', '/')
        missing = len(b64) % 4
        if missing:
            b64 += '=' * (4 - missing)
        try:
            decoded = base64.b64decode(b64)
            # decoded[0] is workchain (0x00 for EQ, 0x80 for UQ)
            workchain = decoded[0]
            hex_part = decoded[1:].hex()
            return f"{workchain}:{hex_part}"
        except Exception:
            pass

    # Fallback: assume already raw without prefix? Add 0:
    if len(addr) == 64 and all(c in "0123456789abcdefABCDEF" for c in addr):
        return f"0:{addr.lower()}"
    return addr.lower()


# ========== CORE: SCAN USER WALLET FOR OUTGOING PAYMENT ==========
async def fetch_user_transactions(user_wallet_raw: str, limit: int = 20):
    """
    Fetch recent transactions of the user's wallet using TonAPI.
    Returns list of transactions with 'out_msgs'.
    """
    url = f"https://tonapi.io/v2/accounts/{user_wallet_raw}/transactions"
    headers = {"Authorization": f"Bearer {TON_API_KEY}"} if TON_API_KEY else {}
    params = {"limit": limit}

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, headers=headers, params=params)
            if resp.status_code != 200:
                logger.error(f"TonAPI error {resp.status_code}: {resp.text[:200]}")
                return []
            data = resp.json()
            return data.get("transactions", [])
        except Exception as e:
            logger.error(f"Failed to fetch user transactions: {e}")
            return []


def find_outgoing_payment(transactions, admin_raw: str, expected_comment_prefix: str, min_amount_nano: int):
    """
    Iterate through transactions and their out_msgs to find a match.
    Returns (tx_hash, amount_nano, comment) or None.
    """
    for tx in transactions:
        tx_hash = tx.get("hash")
        out_msgs = tx.get("out_msgs", [])
        for msg in out_msgs:
            dest = msg.get("destination", {})
            dest_addr = dest.get("address") if isinstance(dest, dict) else str(dest) if dest else ""
            if dest_addr != admin_raw:
                continue
            value = msg.get("value")
            if value is None:
                continue
            try:
                value_nano = int(value)
            except (ValueError, TypeError):
                continue
            if value_nano < min_amount_nano:
                continue
            # Decode comment from message body
            comment = ""
            decoded = msg.get("decoded_body", {})
            if decoded and isinstance(decoded, dict):
                comment = decoded.get("text", "")
            elif "body" in msg and msg["body"]:
                # fallback: not needed if decoded_body is present
                pass
            if comment.startswith(expected_comment_prefix):
                logger.info(f"✅ Found matching tx: {tx_hash} for comment {comment}")
                return tx_hash, value_nano, comment
    return None


async def poll_user_wallet_for_payment(user_id: int, user_wallet_raw: str, admin_raw: str,
                                        expected_comment: str, expected_nano: int,
                                        max_wait: int = POLL_MAX_SECONDS, interval: int = POLL_INTERVAL):
    """
    Poll the user's wallet until a matching outgoing transaction is found.
    Returns (tx_hash, amount, comment) or None.
    """
    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < max_wait:
        txs = await fetch_user_transactions(user_wallet_raw, limit=20)
        result = find_outgoing_payment(txs, admin_raw, expected_comment, expected_nano)
        if result:
            return result
        await asyncio.sleep(interval)
    return None


async def grant_premium(user_id: int, tx_hash: str, amount_nano: int, comment: str):
    """Idempotent premium activation using transaction hash."""
    # Check if already processed
    existing = supabase.table("payments").select("id").eq("transaction_id", tx_hash).execute()
    if existing.data:
        logger.info(f"Transaction {tx_hash} already processed – skipping.")
        return True

    now = datetime.utcnow()
    new_expiry = now + timedelta(days=30)

    # Extend existing premium if still valid
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
        "amount": amount_nano,
        "currency": "nanoTON",
        "payload": comment[:100],
        "transaction_id": tx_hash,
        "status": "completed",
        "created_at": now.isoformat()
    }).execute()

    logger.info(f"✅ Premium granted to user {user_id} via tx {tx_hash}")
    return True


# ========== API ENDPOINTS ==========
@router.post("/api/ton-confirm-payment")
async def confirm_payment(request: Request):
    """
    Expects JSON: { "user_wallet": "user_friendly_or_raw", "comment": "user:123456" }
    Polls user wallet for the outgoing transaction.
    """
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")

    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    user_wallet = body.get("user_wallet")
    expected_comment = body.get("comment")

    if not user_wallet:
        raise HTTPException(status_code=400, detail="Missing user_wallet")
    if not expected_comment:
        raise HTTPException(status_code=400, detail="Missing comment")

    if TON_DEV_MODE:
        logger.info(f"[DEV MODE] Simulating payment for user {user_id}")
        await grant_premium(user_id, "dev_tx_hash", int(TON_AMOUNT * 1e9), expected_comment)
        return {"status": "completed", "message": "Premium activated (dev mode)"}

    if not TON_ADMIN_ADDRESS:
        raise HTTPException(status_code=500, detail="Admin address not configured")

    # Normalize addresses to raw format for TonAPI
    try:
        user_raw = to_raw_ton_address(user_wallet)
        admin_raw = to_raw_ton_address(TON_ADMIN_ADDRESS)
    except Exception as e:
        logger.error(f"Address normalization error: {e}")
        raise HTTPException(status_code=400, detail="Invalid wallet address format")

    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    logger.info(f"Polling user {user_id} wallet {user_raw} for comment {expected_comment}")

    result = await poll_user_wallet_for_payment(
        user_id=user_id,
        user_wallet_raw=user_raw,
        admin_raw=admin_raw,
        expected_comment=expected_comment,
        expected_nano=expected_nano,
        max_wait=POLL_MAX_SECONDS,
        interval=POLL_INTERVAL
    )

    if not result:
        raise HTTPException(status_code=400, detail="Transaction not found after polling")

    tx_hash, amount, comment = result
    success = await grant_premium(user_id, tx_hash, amount, comment)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to grant premium")

    return {"status": "completed", "message": "Premium activated"}


@router.get("/api/ton-config")
async def ton_config():
    return {
        "adminAddress": TON_ADMIN_ADDRESS,
        "amount": TON_AMOUNT
    }


# ========== DEBUG ENDPOINT ==========
@router.get("/debug/ton-payment")
async def debug_ton_payment(wallet: str = None):
    """
    Debug endpoint. If ?wallet=... is provided, fetches last 5 transactions
    and shows them. Otherwise shows configuration.
    """
    debug = {
        "admin_address_raw": to_raw_ton_address(TON_ADMIN_ADDRESS) if TON_ADMIN_ADDRESS else None,
        "admin_address_original": TON_ADMIN_ADDRESS,
        "ton_amount": TON_AMOUNT,
        "ton_api_key_configured": bool(TON_API_KEY),
        "dev_mode": TON_DEV_MODE,
        "poll_max_seconds": POLL_MAX_SECONDS,
        "poll_interval": POLL_INTERVAL,
        "troubleshooting_tips": [
            "TON_ADMIN_ADDRESS must be set to a user‑friendly (EQ...) or raw (0:...) address",
            "TON_API_KEY must be a valid TonAPI v2 key (get from https://tonapi.io)",
            "The user wallet must be connected and must send the exact amount + comment",
            "Transactions may take 10‑30 seconds to appear; polling runs for 45 seconds"
        ]
    }

    if wallet:
        try:
            raw_wallet = to_raw_ton_address(wallet)
            debug["input_wallet"] = wallet
            debug["normalized_wallet_raw"] = raw_wallet
            txs = await fetch_user_transactions(raw_wallet, limit=5)
            debug["transactions_found"] = len(txs)
            debug["transactions"] = []
            for tx in txs[:5]:
                out = []
                for msg in tx.get("out_msgs", []):
                    dest = msg.get("destination", {})
                    out.append({
                        "destination": dest.get("address") if isinstance(dest, dict) else str(dest),
                        "value": msg.get("value"),
                        "decoded_body": msg.get("decoded_body", {})
                    })
                debug["transactions"].append({
                    "hash": tx.get("hash"),
                    "utime": tx.get("utime"),
                    "out_msgs": out
                })
        except Exception as e:
            debug["error"] = str(e)

    return debug
