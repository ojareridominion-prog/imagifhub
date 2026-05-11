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

# Configuration from environment variables
TON_ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "").strip()
TON_AMOUNT = float(os.environ.get("TON_AMOUNT", "1.12"))
TON_API_KEY = os.environ.get("TON_API_KEY", "")
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"

POLL_MAX_SECONDS = 45
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
        return address

    if len(address) == 64 and all(c in "0123456789abcdefABCDEF" for c in address):
        return f"0:{address.lower()}"

    b64 = address.replace('-', '+').replace('_', '/')
    padding = '=' * (-len(b64) % 4)
    b64 += padding

    try:
        data = base64.b64decode(b64)
        workchain_byte = data[1]
        workchain = -1 if workchain_byte == 255 else workchain_byte
        account_id = data[2:34]   
        hex_part = binascii.hexlify(account_id).decode()
        return f"{workchain}:{hex_part}"
    except Exception as e:
        logger.error(f"Failed to decode address {address}: {e}")
        raise


async def fetch_user_events(user_wallet_raw: str, limit: int = 10):
    """
    Fetches high-level events using the TonAPI v2 Account Events endpoint.
    This replaces the broken /transactions endpoint.
    """
    url = f"https://tonapi.io/v2/accounts/{user_wallet_raw}/events"
    headers = {"Authorization": f"Bearer {TON_API_KEY}"} if TON_API_KEY else {}
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            # We fetch 'events' because TonAPI automatically decodes 
            # the transfer details and comments for us.
            resp = await client.get(url, headers=headers, params={"limit": limit})
            
            if resp.status_code != 200:
                logger.error(f"TonAPI error {resp.status_code}: {resp.text[:500]}")
                return []
                
            data = resp.json()
            return data.get("events", [])
        except Exception as e:
            logger.error(f"Exception fetching events: {e}", exc_info=True)
            return []


def find_payment_in_events(events, admin_raw: str, expected_comment: str, min_nano: int):
    """
    Searches through TonAPI events for a matching TonTransfer action.
    """
    for event in events:
        event_id = event.get("event_id")
        
        for action in event.get("actions", []):
            if action.get("type") == "TonTransfer":
                transfer = action.get("ton_transfer", {})
                
                # Normalize values for comparison
                recipient = transfer.get("recipient", {}).get("address")
                amount = transfer.get("amount", 0)
                comment = transfer.get("comment", "")

                if recipient == admin_raw and amount >= min_nano and comment == expected_comment:
                    logger.info(f"✅ Matching payment found! Event: {event_id}")
                    return event_id, amount, comment
                    
    return None


async def poll_user_wallet_for_payment(user_wallet_raw: str, admin_raw: str,
                                        expected_comment: str, expected_nano: int,
                                        max_wait: int = POLL_MAX_SECONDS, interval: int = POLL_INTERVAL):
    """
    Polls the wallet until a matching event is found or timeout occurs.
    """
    start = asyncio.get_event_loop().time()
    
    while (asyncio.get_event_loop().time() - start) < max_wait:
        events = await fetch_user_events(user_wallet_raw, limit=10)
        result = find_payment_in_events(events, admin_raw, expected_comment, expected_nano)
        
        if result:
            return result
            
        await asyncio.sleep(interval)
        
    return None


async def grant_premium(user_id: int, tx_hash: str, amount_nano: int, comment: str):
    """
    Updates Supabase to reflect the user's new premium status.
    """
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
            if current_expiry > now:
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

    if not user_wallet or not expected_comment:
        raise HTTPException(status_code=400, detail="Missing wallet or comment")

    if TON_DEV_MODE:
        await grant_premium(user_id, "dev_tx_hash", int(TON_AMOUNT * 1e9), expected_comment)
        return {"status": "completed", "message": "Dev mode active"}

    try:
        user_raw = to_raw_ton_address(user_wallet)
        admin_raw = to_raw_ton_address(TON_ADMIN_ADDRESS)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid address format")

    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    
    # Start the polling process
    result = await poll_user_wallet_for_payment(
        user_raw, admin_raw, expected_comment, expected_nano
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
    """
    Debug helper updated to show TonAPI events.
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
                                       
