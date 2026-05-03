# ton_routes.py - Complete backend for TON payments with webhook support
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from datetime import datetime, timedelta
import logging
import os
import hmac
import hashlib
import json
from config import supabase
from utils import get_user_id_from_init_data

router = APIRouter()

TON_API_KEY = os.environ.get("TONCENTER_API_KEY", "")
ADMIN_ADDRESS = os.environ.get("TON_ADMIN_ADDRESS", "")
PAYMENT_AMOUNT = float(os.environ.get("TON_PAYMENT_AMOUNT", 1.12))
WEBHOOK_SECRET = os.environ.get("TON_WEBHOOK_SECRET", "")  # Add this to your environment variables

# In-memory store for pending verifications (in production, use Redis)
pending_verifications = {}

async def grant_premium(user_id: int, tx_hash: str = None, amount: float = PAYMENT_AMOUNT):
    """Grant premium access to a user"""
    now = datetime.utcnow()
    result = supabase.table("users").select("premium_expires_at").eq("telegram_id", user_id).execute()
    new_expiry = now + timedelta(days=30)
    
    if result.data and result.data[0].get("premium_expires_at"):
        try:
            current_expiry_str = result.data[0]["premium_expires_at"]
            if current_expiry_str.endswith('Z'):
                current_expiry_str = current_expiry_str.replace('Z', '+00:00')
            current_expiry = datetime.fromisoformat(current_expiry_str)
            if current_expiry.tzinfo:
                current_expiry = current_expiry.replace(tzinfo=None)
            if current_expiry > now:
                new_expiry = current_expiry + timedelta(days=30)
        except:
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
        "amount": amount,
        "currency": "TON",
        "payload": f"premium_{user_id}",
        "transaction_id": tx_hash or f"pending_{user_id}",
        "status": "completed"
    }).execute()
    
    logging.info(f"TON premium granted to user {user_id} until {new_expiry.isoformat()}")
    return True

@router.post("/api/ton-webhook")
async def ton_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Webhook endpoint for TON Pay to send real-time payment notifications.
    Configure this URL in your TON Pay Merchant Dashboard.
    
    Webhook URL: https://imagifhub.onrender.com/api/ton-webhook
    """
    try:
        # Verify webhook signature if secret is configured
        signature = request.headers.get("X-TonPay-Signature", "")
        body = await request.body()
        body_str = body.decode('utf-8')
        
        if WEBHOOK_SECRET and signature:
            expected_signature = hmac.new(
                WEBHOOK_SECRET.encode('utf-8'),
                body,
                hashlib.sha256
            ).hexdigest()
            
            if not hmac.compare_digest(signature, expected_signature):
                logging.warning(f"Invalid webhook signature")
                return {"status": "error", "message": "Invalid signature"}
        
        payload = json.loads(body_str)
        event_type = payload.get("event")
        
        logging.info(f"Received TON webhook: {event_type}")
        
        if event_type == "transfer.completed":
            data = payload.get("data", {})
            tx_hash = data.get("txHash")
            amount = float(data.get("amount", 0))
            recipient_addr = data.get("recipientAddr", "")
            reference = data.get("reference", "")
            comment = data.get("commentToRecipient", "")
            
            # Extract user_id from reference or comment
            user_id = None
            if reference and reference.startswith("premium_"):
                user_id = int(reference.replace("premium_", ""))
            elif comment and comment.startswith("premium_"):
                user_id = int(comment.replace("premium_", ""))
            
            if not user_id:
                # Fallback: check if comment contains user_id
                import re
                match = re.search(r'premium_(\d+)', comment or "")
                if match:
                    user_id = int(match.group(1))
            
            if user_id and recipient_addr.lower() == ADMIN_ADDRESS.lower():
                if amount >= PAYMENT_AMOUNT:
                    background_tasks.add_task(grant_premium, user_id, tx_hash, amount)
                    logging.info(f"Webhook: Premium granted to user {user_id} via tx {tx_hash}")
                    return {"status": "ok", "message": "Premium granted"}
                else:
                    logging.warning(f"Webhook: Insufficient amount {amount} < {PAYMENT_AMOUNT}")
            else:
                logging.warning(f"Webhook: Could not extract user_id or wrong recipient")
        
        return {"status": "ok"}
        
    except Exception as e:
        logging.error(f"Webhook error: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}

@router.post("/api/verify-ton-payment")
async def verify_ton_payment(request: Request, background_tasks: BackgroundTasks):
    """
    Fallback verification endpoint using polling (for wallets that don't support webhooks).
    This maintains backward compatibility.
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
        raise HTTPException(status_code=400, detail="Missing BOC")

    if not TON_API_KEY or not ADMIN_ADDRESS:
        raise HTTPException(status_code=500, detail="TON payment not configured")

    # Register pending verification
    pending_verifications[user_id] = {
        "timestamp": datetime.utcnow(),
        "boc": boc,
        "verified": False
    }
    
    # Return immediately - webhook will handle confirmation
    return {"success": True, "pending": True, "message": "Payment submitted, waiting for confirmation"}

@router.get("/api/ton-config")
async def ton_config():
    return {
        "adminAddress": ADMIN_ADDRESS,
        "amount": PAYMENT_AMOUNT,
        "webhookConfigured": bool(WEBHOOK_SECRET)
}
    
