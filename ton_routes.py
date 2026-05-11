# ton_routes.py – Poll user wallet via TonAPI (your conversion logic)
import os
import asyncio
import logging
import httpx
import base64
import binascii
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase
from datetime import datetime, timedelta

router = APIRouter()

TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "").strip()
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))
TON_API_KEY = os.environ.get("TON_API_KEY", "")
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"

POLL_MAX_SECONDS = 45
POLL_INTERVAL = 3

logger = logging.getLogger(__name__)


def to_raw_ton_address(address: str) -> str:
    """
    Convert TON user‑friendly address (EQ/UQ/kQ/0Q…) to raw hex format.
    Exact copy of your working Python code.
    """
    address = address.strip()
    if not address:
        return ""

    # Already in raw format
    if address.startswith(('0:', '-1:')):
        return address

    # Raw without prefix (64 hex chars) – assume workchain 0
    if len(address) == 64 and all(c in "0123456789abcdefABCDEF" for c in address):
        return f"0:{address.lower()}"

    # User‑friendly format
    # Remove the first two characters (EQ, UQ, etc.)
    addr = address[2:]
    # Convert URL‑safe base64 to standard
    addr = addr.replace('-', '+').replace('_', '/')
    # Add padding if missing
    padding = '=' * (-len(addr) % 4)
    addr += padding

    try:
        data = base64.b64decode(addr)
        # Byte 0 = tag, byte 1 = workchain, bytes 2-33 = account ID, bytes 34-35 = checksum
        workchain_byte = data[1]
        # Convert signed byte
        if workchain_byte == 255:
            workchain = -1
        else:
            workchain = workchain_byte
        account_id = data[2:34]   # 32 bytes
        hex_part = binascii.hexlify(account_id).decode()
        return f"{workchain}:{hex_part}"
    except Exception as e:
        logger.error(f"Failed to decode address {address}: {e}")
        raise


async def fetch_user_transactions(user_wallet_raw: str, limit: int = 20):
    url = f"https://tonapi.io/v2/accounts/{user_wallet_raw}/transactions"
    headers = {"Authorization": f"Bearer {TON_API_KEY}"} if TON_API_KEY else {}
    params = {"limit": limit}

    logger.info(f"TonAPI request: {url}")
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, headers=headers, params=params)
            logger.info(f"TonAPI status: {resp.status_code}")
            if resp.status_code != 200:
                logger.error(f"TonAPI error {resp.status_code}: {resp.text[:500]}")
                return []
            data = resp.json()
            return data.get("transactions", [])
        except Exception as e:
            logger.error(f"Exception fetching transactions: {e}", exc_info=True)
            return []


def find_outgoing_payment(transactions, admin_raw: str, expected_comment_prefix: str, min_amount_nano: int):
    for tx in transactions:
        tx_hash = tx.get("hash")
        out_msgs = tx.get("out_msgs", [])
        for msg in out_msgs:
            dest = msg.get("destination", {})
            dest_addr = dest.get("address") if isinstance(dest, dict) else str(dest) if dest else ""
            if not dest_addr:
                continue
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
            comment = ""
            decoded = msg.get("decoded_body", {})
            if decoded and isinstance(decoded, dict):
                comment = decoded.get("text", "")
            if comment.startswith(expected_comment_prefix):
                logger.info(f"✅ Found tx {tx_hash} amount {value_nano} comment {comment}")
                return tx_hash, value_nano, comment
    return None


async def poll_user_wallet_for_payment(user_id: int, user_wallet_raw: str, admin_raw: str,
                                        expected_comment: str, expected_nano: int,
                                        max_wait: int = POLL_MAX_SECONDS, interval: int = POLL_INTERVAL):
    start = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start) < max_wait:
        txs = await fetch_user_transactions(user_wallet_raw, limit=20)
        result = find_outgoing_payment(txs, admin_raw, expected_comment, expected_nano)
        if result:
            return result
        await asyncio.sleep(interval)
    return None


async def grant_premium(user_id: int, tx_hash: str, amount_nano: int, comment: str):
    existing = supabase.table("payments").select("id").eq("transaction_id", tx_hash).execute()
    if existing.data:
        logger.info(f"Tx {tx_hash} already processed")
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


@router.post("/api/ton-confirm-payment")
async def confirm_payment(request: Request):
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
        logger.info(f"DEV MODE: granting premium to user {user_id}")
        await grant_premium(user_id, "dev_tx_hash", int(TON_AMOUNT * 1e9), expected_comment)
        return {"status": "completed", "message": "Premium activated (dev mode)"}

    if not TON_ADMIN_ADDRESS:
        raise HTTPException(status_code=500, detail="Admin address not configured")

    try:
        user_raw = to_raw_ton_address(user_wallet)
        admin_raw = to_raw_ton_address(TON_ADMIN_ADDRESS)
        logger.info(f"User raw: {user_raw}")
        logger.info(f"Admin raw: {admin_raw}")
    except Exception as e:
        logger.error(f"Address conversion error: {e}")
        raise HTTPException(status_code=400, detail="Invalid wallet address format")

    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    logger.info(f"Polling user {user_id} for comment {expected_comment}")

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
    await grant_premium(user_id, tx_hash, amount, comment)
    return {"status": "completed", "message": "Premium activated"}


@router.get("/api/ton-config")
async def ton_config():
    return {"adminAddress": TON_ADMIN_ADDRESS, "amount": TON_AMOUNT}


@router.get("/debug/ton-payment")
async def debug_ton_payment(wallet: str = None):
    debug = {
        "admin_address": TON_ADMIN_ADDRESS,
        "admin_address_raw": to_raw_ton_address(TON_ADMIN_ADDRESS) if TON_ADMIN_ADDRESS else None,
        "ton_amount": TON_AMOUNT,
        "ton_api_key_configured": bool(TON_API_KEY),
        "dev_mode": TON_DEV_MODE,
        "poll_max_seconds": POLL_MAX_SECONDS,
        "poll_interval": POLL_INTERVAL,
        "troubleshooting_tips": [
            "Your conversion logic exactly matches the provided Python script",
            "Admin address (EQ...) → workchain 0: account ID = 32 bytes (64 hex chars)",
            "User wallet (UQ...) → workchain -1: account ID = 32 bytes",
            "TonAPI accepts raw format: 0:... or -1:...",
            "Make sure you actually sent a transaction with the correct amount and comment"
        ]
    }

    if wallet:
        try:
            wallet_raw = to_raw_ton_address(wallet)
            debug["input_wallet"] = wallet
            debug["normalized_wallet_raw"] = wallet_raw
            txs = await fetch_user_transactions(wallet_raw, limit=5)
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
    
