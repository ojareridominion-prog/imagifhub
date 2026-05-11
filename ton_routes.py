import os
import re
import asyncio
import logging
import httpx
import base64
from fastapi import APIRouter, Request, HTTPException
from utils import get_user_id_from_init_data
from config import supabase
from datetime import datetime, timedelta

router = APIRouter()

# Configuration from environment
TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "").strip()
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "0.01"))
TON_API_KEY = os.environ.get("TON_API_KEY", "")

POLL_MAX_SECONDS = 60          # 60 seconds timeout
POLL_INTERVAL = 3
EVENTS_LIMIT = 15              # increased from 5

# Idempotency locks: key = transaction_id, value = asyncio.Lock
_payment_locks = {}

logger = logging.getLogger(__name__)


def to_raw_ton_address(address: str) -> str:
    """Convert TON user-friendly address to raw hex format (workchain:hash)."""
    address = address.strip()
    if not address:
        return ""

    if address.startswith(('0:', '-1:')):
        return address.lower()

    if len(address) == 64 and all(c in "0123456789abcdefABCDEF" for c in address):
        return f"0:{address.lower()}"

    b64 = address.replace('-', '+').replace('_', '/')
    padding = '=' * (-len(b64) % 4)
    b64 += padding

    try:
        data = base64.b64decode(b64)
        workchain = data[1]
        if workchain == 0xff:
            workchain = -1
        hash_part = data[2:34].hex()
        return f"{workchain}:{hash_part}".lower()
    except Exception as e:
        logger.error(f"Error decoding address {address}: {e}")
        return ""


async def fetch_user_events(account_id: str, limit: int = EVENTS_LIMIT):
    """Fetch recent account events from TonAPI."""
    url = f"https://tonapi.io/v2/accounts/{account_id}/events?limit={limit}"
    headers = {"Authorization": f"Bearer {TON_API_KEY}"} if TON_API_KEY else {}

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                return resp.json().get("events", [])
            logger.error(f"TonAPI error: {resp.status_code} - {resp.text}")
        except Exception as e:
            logger.error(f"Failed to fetch events: {e}")
    return []


def find_payment_in_events(events, admin_raw: str, expected_comment: str, min_nano: int):
    """
    Search events for a matching TonTransfer action.
    Also checks that the event timestamp is not older than 2 hours.
    """
    target_address = admin_raw.lower()
    now_ts = int(datetime.utcnow().timestamp())
    two_hours_ago = now_ts - 7200   # 2 hours

    for event in events:
        if event.get("in_progress") is True:
            continue

        event_ts = event.get("timestamp")
        if event_ts and event_ts < two_hours_ago:
            logger.info(f"Skipping event older than 2h: ts={event_ts}")
            continue

        for action in event.get("actions", []):
            if action.get("type") == "TonTransfer" and action.get("status") == "ok":
                transfer = action.get("TonTransfer") or action.get("ton_transfer") or {}
                if not transfer:
                    continue

                recipient = transfer.get("recipient", {}).get("address", "").lower()
                amount = int(transfer.get("amount", 0))
                comment = transfer.get("comment", "")

                logger.info(f"Inspecting Transfer: To={recipient}, Amount={amount}, Comment='{comment}'")

                if recipient == target_address and amount >= min_nano and comment == expected_comment:
                    return event.get("event_id"), amount, comment
    return None


async def poll_user_wallet_for_payment(user_raw, admin_raw, comment, expected_nano):
    """Poll blockchain until transaction appears or timeout."""
    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < POLL_MAX_SECONDS:
        logger.info(f"Polling TonAPI for wallet: {user_raw}")
        events = await fetch_user_events(user_raw)
        match = find_payment_in_events(events, admin_raw, comment, expected_nano)
        if match:
            return match
        await asyncio.sleep(POLL_INTERVAL)
    return None


async def grant_premium(telegram_id: int, tx_hash: str, amount: int, comment: str):
    """
    Grant 30 days premium, extending existing expiry if it's further in the future.
    Idempotent: uses per-transaction lock.
    """
    # Acquire lock for this transaction_id to prevent race conditions
    lock = _payment_locks.get(tx_hash)
    if lock is None:
        lock = asyncio.Lock()
        _payment_locks[tx_hash] = lock

    async with lock:
        # Check again if payment already processed (double-check)
        existing = supabase.table("payments").select("id").eq("transaction_id", tx_hash).execute()
        if existing.data:
            logger.warning(f"Payment {tx_hash} already processed – skipping duplicate")
            return

        # Get current user record
        user_result = supabase.table("users").select("premium_expires_at").eq("telegram_id", telegram_id).execute()
        now = datetime.utcnow()
        new_expiry = now + timedelta(days=30)

        if user_result.data and user_result.data[0].get("premium_expires_at"):
            current_expiry_str = user_result.data[0]["premium_expires_at"]
            try:
                if current_expiry_str.endswith('Z'):
                    current_expiry_str = current_expiry_str.replace('Z', '+00:00')
                current_expiry = datetime.fromisoformat(current_expiry_str)
                if current_expiry.tzinfo:
                    current_expiry = current_expiry.replace(tzinfo=None)
                if current_expiry > now and current_expiry > new_expiry:
                    new_expiry = current_expiry + timedelta(days=30)   # extend further
                    logger.info(f"Extending existing premium for user {telegram_id} from {current_expiry} to {new_expiry}")
            except Exception as e:
                logger.warning(f"Failed to parse existing expiry: {e}")

        # Insert payment record
        payment_data = {
            "telegram_id": telegram_id,
            "provider": "ton",
            "amount": amount,          # nano TON
            "currency": "nanoTON",
            "transaction_id": tx_hash,
            "status": "completed"
        }
        supabase.table("payments").insert(payment_data).execute()

        # Update user premium status
        supabase.table("users").upsert({
            "telegram_id": telegram_id,
            "is_premium": True,
            "premium_expires_at": new_expiry.isoformat()
        }).execute()

        logger.info(f"Premium granted to {telegram_id} via TON, tx: {tx_hash}, amount_nano={amount}, expires: {new_expiry.isoformat()}")

    # Clean up lock after processing (optional, to avoid memory leak)
    _payment_locks.pop(tx_hash, None)


@router.post("/api/ton-confirm-payment")
async def ton_confirm_payment(request: Request):
    """
    Endpoint called by frontend to verify a TON payment.
    Validates comment format, polls blockchain, and grants premium.
    """
    init_data_raw = request.headers.get("X-Telegram-Init-Data")
    user_id = get_user_id_from_init_data(init_data_raw)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    body = await request.json()
    user_wallet = body.get("user_wallet")
    expected_comment = body.get("comment")

    if not user_wallet or not expected_comment:
        raise HTTPException(status_code=400, detail="Missing wallet or comment")

    # Validate comment format: must be exactly "user:123456789"
    if not re.match(r'^user:\d+$', expected_comment):
        raise HTTPException(status_code=400, detail="Invalid comment format")

    try:
        user_raw = to_raw_ton_address(user_wallet)
        admin_raw = to_raw_ton_address(TON_ADMIN_ADDRESS)
        if not admin_raw:
            raise HTTPException(status_code=500, detail="Admin address not configured")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid address format")

    expected_nano = int(TON_AMOUNT * 1_000_000_000)

    result = await poll_user_wallet_for_payment(
        user_raw, admin_raw, expected_comment, expected_nano
    )

    if not result:
        raise HTTPException(status_code=400, detail="Transaction not found. Please wait a few seconds and try again.")

    tx_hash, amount, comment = result
    await grant_premium(user_id, tx_hash, amount, comment)

    return {"status": "completed", "message": "Premium activated"}


@router.get("/api/ton-config")
async def ton_config():
    return {"adminAddress": TON_ADMIN_ADDRESS, "amount": TON_AMOUNT}


@router.get("/debug/ton-payment")
async def debug_ton_payment(wallet: str = None):
    """Helper to verify the state of the payment system."""
    debug = {
        "admin_address": TON_ADMIN_ADDRESS,
        "ton_amount": TON_AMOUNT,
        "ton_api_key_configured": bool(TON_API_KEY)
    }
    if wallet:
        try:
            raw = to_raw_ton_address(wallet)
            events = await fetch_user_events(raw, limit=EVENTS_LIMIT)
            debug["normalized_wallet_raw"] = raw
            debug["events_found"] = len(events)
            # Optional: show first 3 events (avoid huge responses)
            debug["sample_events"] = events[:3] if events else []
        except Exception as e:
            debug["error"] = str(e)
    return debug
    
