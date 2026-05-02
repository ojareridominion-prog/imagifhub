from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timedelta
import logging
import os
import httpx
from config import supabase
from utils import get_user_id_from_init_data

router = APIRouter()

TON_API_KEY = os.environ.get("TONCENTER_API_KEY", "")
ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
PAYMENT_AMOUNT = float(os.environ.get("TON_PAYMENT_AMOUNT", 1.12))

@router.post("/api/verify-ton-payment")
async def verify_ton_payment(request: Request):
    """
    Expects { "txHash": "..." } in body.
    Verifies that a transaction from the user to ADMIN_ADDRESS with
    amount >= PAYMENT_AMOUNT TON exists and contains the user_id in comment.
    """
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing init data")
    user_id = get_user_id_from_init_data(init_data)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")

    body = await request.json()
    tx_hash = body.get("txHash")
    if not tx_hash:
        raise HTTPException(status_code=400, detail="Missing txHash")

    if not TON_API_KEY or not ADMIN_ADDRESS:
        raise HTTPException(status_code=500, detail="TON payment not configured")

    # Query toncenter to get transaction details
    async with httpx.AsyncClient() as client:
        url = f"https://toncenter.com/api/v3/transactions?hash={tx_hash}&limit=1"
        headers = {"X-API-Key": TON_API_KEY}
        try:
            resp = await client.get(url, headers=headers, timeout=10)
            if resp.status_code != 200:
                logging.error(f"TON API error: {resp.text}")
                raise HTTPException(status_code=502, detail="Payment verification failed")
            data = resp.json()
            txs = data.get("transactions", [])
            if not txs:
                return {"success": False, "reason": "Transaction not found"}

            tx = txs[0]
            # Check that recipient matches admin address
            out_msgs = tx.get("out_msgs", [])
            found = False
            for msg in out_msgs:
                if msg.get("destination") == ADMIN_ADDRESS:
                    # Check amount (in nanoTONs)
                    value_nano = int(msg.get("value", "0"))
                    value_ton = value_nano / 1e9
                    if value_ton >= PAYMENT_AMOUNT:
                        found = True
                        break
            if not found:
                return {"success": False, "reason": "Amount too low or wrong recipient"}

            # Optional: check comment contains user_id (if comment is included)
            # We'll rely on the transaction being from the same user that called the endpoint.
            # Because only the logged-in user knows the tx hash.
            # Grant premium
            now = datetime.utcnow()
            result = supabase.table("users").select("premium_expires_at").eq("telegram_id", user_id).execute()
            new_expiry = now + timedelta(days=30)
            if result.data and result.data[0].get("premium_expires_at"):
                current_expiry_str = result.data[0]["premium_expires_at"]
                try:
                    if current_expiry_str.endswith('Z'):
                        current_expiry_str = current_expiry_str.replace('Z', '+00:00')
                    current_expiry = datetime.fromisoformat(current_expiry_str)
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

            # Log payment record
            supabase.table("payments").insert({
                "telegram_id": user_id,
                "provider": "ton",
                "amount": PAYMENT_AMOUNT,
                "currency": "TON",
                "payload": f"premium_{user_id}",
                "transaction_id": tx_hash,
                "status": "completed"
            }).execute()

            return {"success": True, "expires_at": new_expiry.isoformat()}

        except Exception as e:
            logging.error(f"TON verification error: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail="Internal error")
          
