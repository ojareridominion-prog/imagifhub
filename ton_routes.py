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
TON_API_KEY = os.environ.get("TON_API_KEY", "")                   # optional for toncenter
TON_DEV_MODE = os.environ.get("TON_DEV_MODE", "false").lower() == "true"

# toncenter endpoints (mainnet)
TONCENTER_API_URL = "https://toncenter.com/api/v2"

logger = logging.getLogger(__name__)


# ========== ADDRESS NORMALIZATION ==========
def normalize_ton_address(addr: str) -> str:
    """
    Convert any TON address to its raw hex representation (without 0: prefix).
    Handles raw hex (0:...), raw hex without prefix, and user‑friendly (EQ/UQ...).
    """
    addr = addr.strip()
    if not addr:
        return ""

    # Already raw hex without prefix?
    if len(addr) == 64 and all(c in "0123456789abcdefABCDEF" for c in addr):
        return addr.lower()

    # Raw hex with 0: prefix
    if addr.startswith("0:"):
        return addr[2:].lower()

    # User‑friendly format (EQ... or UQ...)
    if addr.startswith("EQ") or addr.startswith("UQ"):
        # Decode base64url to bytes
        b64 = addr[2:].replace('-', '+').replace('_', '/')
        # Add padding if needed
        missing = len(b64) % 4
        if missing:
            b64 += '=' * (4 - missing)
        try:
            decoded = base64.b64decode(b64)
            # First byte is workchain (usually 0x11 for EQ, 0x12 for UQ)
            # Rest is the raw hex part (64 hex chars = 32 bytes)
            hex_part = decoded[1:].hex()
            return hex_part
        except Exception:
            pass

    # Fallback: return as is (lowercase)
    return addr.lower()


# ========== HELPER: VERIFY TRANSACTION BY HASH (legacy) ==========
async def verify_transaction_by_hash(tx_hash: str, expected_amount_nano: int) -> bool:
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

    url = f"{TONCENTER_API_URL}/getTransaction"
    params = {"hash": tx_hash, "shardblock": None}

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

            dest = txn.get("to")
            if not dest:
                out_msgs = txn.get("out_msgs", [])
                if out_msgs and len(out_msgs) > 0:
                    dest = out_msgs[0].get("destination")
            if not dest:
                logger.error("Could not extract destination address from transaction")
                return False

            admin_norm = normalize_ton_address(TON_ADMIN_ADDRESS)
            dest_norm = normalize_ton_address(dest)
            if admin_norm != dest_norm:
                logger.error(f"Destination mismatch: {dest_norm} != {admin_norm}")
                return False

            value_nano = txn.get("value")
            if value_nano is None:
                value_nano = txn.get("amount")
            if value_nano is None:
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


# ========== MAIN VERIFICATION: CHECK WALLET OUTGOING TRANSACTIONS ==========
async def check_wallet_payment(wallet_addr: str, expected_amount_nano: int) -> bool:
    """
    Fetch last few outgoing transactions of the given wallet.
    Returns True if a payment to TON_ADMIN_ADDRESS with amount >= expected_amount_nano is found.
    """
    if TON_DEV_MODE:
        logger.error(f"[DEV MODE] Skipping real TON check for wallet {wallet_addr}")
        return True

    if not TON_ADMIN_ADDRESS:
        logger.error("TON_ADMIN_ADDRESS not set")
        return False

    headers = {}
    if TON_API_KEY:
        headers["X-API-Key"] = TON_API_KEY

    # Get transactions for the wallet (limit 5 for speed)
    url = f"{TONCENTER_API_URL}/getTransactions"
    params = {
        "address": wallet_addr,
        "limit": 5,                # reduced from 20 for faster polling
        "archival": True
    }

    admin_norm = normalize_ton_address(TON_ADMIN_ADDRESS)
    logger.error(f"Normalized admin address: {admin_norm}")

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, params=params, headers=headers)
            logger.error(f"Toncenter response status: {resp.status_code}")
            if resp.status_code != 200:
                logger.error(f"toncenter error {resp.status_code}: {resp.text}")
                return False

            data = resp.json()
            if not data.get("ok"):
                logger.error(f"toncenter returned not ok: {data}")
                return False

            transactions = data.get("result", [])
            logger.error(f"Found {len(transactions)} transactions for wallet {wallet_addr}")
            if not transactions:
                logger.error(f"No transactions found for wallet {wallet_addr}")
                return False

            for idx, tx in enumerate(transactions):
                tx_hash = tx.get("transaction_id", {}).get("hash", "unknown")
                logger.error(f"Transaction {idx}: hash={tx_hash}")

                out_msgs = tx.get("out_msgs", [])
                logger.error(f"  out_msgs count: {len(out_msgs)}")
                for msg_idx, msg in enumerate(out_msgs):
                    dest = msg.get("destination", "")
                    value = msg.get("value")
                    logger.error(f"    msg {msg_idx}: dest={dest}, value={value}")
                    if not dest:
                        continue
                    dest_norm = normalize_ton_address(dest)
                    if dest_norm != admin_norm:
                        continue
                    if value is None:
                        continue
                    try:
                        value_nano = int(value)
                    except (ValueError, TypeError):
                        continue
                    if value_nano >= expected_amount_nano:
                        logger.error(f"✅ MATCH found: {value_nano} nano to {dest}")
                        return True

            logger.error(f"No matching payment found for wallet {wallet_addr} in last 5 transactions")
            return False

        except Exception as e:
            logger.error(f"Exception checking wallet transactions: {e}", exc_info=True)
            return False


# ========== ENDPOINTS ==========

@router.get("/api/ton-config")
async def ton_config():
    return {
        "adminAddress": TON_ADMIN_ADDRESS,
        "amount": TON_AMOUNT
    }


@router.get("/api/ton-check-tx")
async def check_transaction(request: Request):
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


@router.get("/api/ton-check-payment")
async def check_payment(request: Request):
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")

    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    wallet = request.query_params.get("wallet")
    amount_str = request.query_params.get("amount")

    if not wallet or not amount_str:
        raise HTTPException(status_code=400, detail="Missing wallet or amount")

    try:
        amount_ton = float(amount_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid amount")

    expected_nano = int(amount_ton * 1_000_000_000)

    logger.error(f"Checking payment for user {user_id}, wallet {wallet}, expected {expected_nano} nano")

    paid = await check_wallet_payment(wallet, expected_nano)

    if paid:
        tx_hash = f"wallet_{wallet}_{int(datetime.utcnow().timestamp())}"
        return await _grant_premium(user_id, tx_hash)
    else:
        return {"status": "pending"}


@router.get("/api/debug-ton-wallet")
async def debug_ton_wallet(wallet: str):
    """
    DEBUG ENDPOINT: returns raw toncenter response for the given wallet.
    No authentication – use only for debugging.
    """
    headers = {}
    if TON_API_KEY:
        headers["X-API-Key"] = TON_API_KEY

    url = f"{TONCENTER_API_URL}/getTransactions"
    params = {
        "address": wallet,
        "limit": 5,
        "archival": True
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, params=params, headers=headers)
        return {
            "status_code": resp.status_code,
            "headers": dict(resp.headers),
            "body": resp.json() if resp.status_code == 200 else resp.text
        }


@router.post("/api/ton-verify-boc")
async def verify_boc(request: Request):
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
        return await _grant_premium(user_id, "dev_boc")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            decode_url = f"{TONCENTER_API_URL}/decodeBoc"
            decode_resp = await client.post(decode_url, json={"boc": boc})
            if decode_resp.status_code != 200:
                logger.error(f"Failed to decode BOC: {decode_resp.text}")
                raise HTTPException(status_code=400, detail="Invalid BOC")

            decode_data = decode_resp.json()
            tx_hash = None
            if "hash" in decode_data:
                tx_hash = decode_data["hash"]
            elif "transactions" in decode_data and len(decode_data["transactions"]) > 0:
                tx_hash = decode_data["transactions"][0].get("hash")
            if not tx_hash:
                raise HTTPException(status_code=400, detail="Could not extract tx hash from BOC")

        expected_nano = int(TON_AMOUNT * 1_000_000_000)
        verified = await verify_transaction_by_hash(tx_hash, expected_nano)
        if not verified:
            raise HTTPException(status_code=400, detail="Transaction verification failed")

        return await _grant_premium(user_id, tx_hash)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"BOC verification error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


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

    # Store amount as integer (nanoTON)
    expected_nano = int(TON_AMOUNT * 1_000_000_000)
    supabase.table("payments").insert({
        "telegram_id": user_id,
        "provider": "ton",
        "amount": expected_nano,           # integer (nanoTON)
        "currency": "nanoTON",
        "payload": f"ton_{user_id}_{tx_hash[:8]}",
        "transaction_id": tx_hash,
        "status": "completed",
        "created_at": now.isoformat()
    }).execute()

    logger.info(f"✅ TON payment verified for user {user_id}, tx_hash/ref {tx_hash}")
    return {"status": "completed", "message": "Premium activated"}
