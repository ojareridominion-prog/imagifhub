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

# Configuration from environment variables
TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "").strip()
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "0.01"))
TON_API_KEY = os.environ.get("TON_API_KEY", "")

POLL_MAX_SECONDS = 60  # Increased slightly for network reliability
POLL_INTERVAL = 3

logger = logging.getLogger(__name__)


def to_raw_ton_address(address: str) -> str:
    """
    Convert TON user-friendly address to raw hex format.
    """
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
        # The raw address is usually at bytes 2-34
        workchain = data[1]
        if workchain == 0xff:
            workchain = -1
        hash_part = data[2:34].hex()
        return f"{workchain}:{hash_part}".lower()
    except Exception as e:
        logger.error(f"Error decoding address {address}: {e}")
        return ""


async def fetch_user_events(account_id: str, limit: int = 5):
    """
    Fetches account events from TonAPI.
    """
    url = f"https://tonapi.io/v2/accounts/{account_id}/events?limit={limit}"
    headers = {}
    if TON_API_KEY:
        headers["Authorization"] = f"Bearer {TON_API_KEY}"

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
    Searches through TonAPI events for a matching TonTransfer action.
    """
    # Normalize admin address to lowercase for safe comparison
    target_address = admin_raw.lower()

    for event in events:
        # Skip events still being processed by the indexer
        if event.get("in_progress") is True:
            continue

        for action in event.get("actions", []):
            # TonAPI v2 uses "TonTransfer" (PascalCase) in the JSON payload
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
    """
    Polls the blockchain until the transaction appears or timeout is reached.
    """
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
    Updates the database to grant premium status.
    """
    expires_at = (datetime.utcnow() + timedelta(days=365)).isoformat()
    
    # Check if payment hash already exists to prevent double-spending
    existing = supabase.table("payments").select("id").eq("tx_hash", tx_hash).execute()
    if existing.data:
        logger.warning(f"Duplicate payment attempt: {tx_hash}")
        return

    # Record payment
    supabase.table("payments").insert({
        "telegram_id": telegram_id,
        "tx_hash": tx_hash,
        "amount": amount / 1_000_000_000,
        "comment": comment,
        "status": "completed"
    }).execute()

    # Update user status
    supabase.table("users").update({
        "is_premium": True,
        "premium_expires_at": expires_at
    }).eq("telegram_id", telegram_id).execute()
    
    logger.info(f"Premium granted to {telegram_id}")


@router.post("/api/ton-confirm-payment")
async def ton_confirm_payment(request: Request):
    """
    Endpoint called by frontend to trigger transaction verification.
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

    try:
        user_raw = to_raw_ton_address(user_wallet)
        admin_raw = to_raw_ton_address(TON_ADMIN_ADDRESS)
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
    """
    Helper to verify the state of the payment system.
    """
    debug = {
        "admin_address": TON_ADMIN_ADDRESS,
        "ton_amount": TON_AMOUNT,
        "ton_api_key_configured": bool(TON_API_KEY)
    }
    
    if wallet:
        try:
            raw = to_raw_ton_address(wallet)
            events = await fetch_user_events(raw, limit=5)
            debug["normalized_wallet_raw"] = raw
            debug["events_found"] = len(events)
            debug["events"] = events
        except Exception as e:
            debug["error"] = str(e)
            
    return debug
    
