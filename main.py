from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import logging
import os
import threading
import asyncio
import ping
from config import bot, dp

# Import routers
from webhook import router as webhook_router
from invoice import router as invoice_router
from premium import router as premium_router
from media import router as media_router
from admin import router as admin_router
from ads_router import router as ads_router
from ad_trigger import router as ad_trigger_router
from gift_routes import router as gift_router          # NEW
from ton_routes import router as ton_router            # NEW for TON payments

# Import bot handlers to register them with dispatcher
import bot_handlers  # noqa

# Import premium expiry checker
from premium_expiry_checker import run_expiry_checker

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# TON Connect manifest – required for TonConnect SDK
# main.py (only the relevant part – replace the existing manifest route)

@app.get("/ton-manifest.json")
async def ton_manifest(request: Request):
    # Use the request's base URL (scheme + host)
    base_url = str(request.base_url).rstrip('/')
    return {
        "url": base_url,
        "name": "IMAGIFHUB",
        "iconUrl": f"{base_url}/assets/icon.png",
        "termsOfUseUrl": f"{base_url}/terms",
        "privacyPolicyUrl": f"{base_url}/privacy"
    }

@app.get("/debug/ton-manifest")
async def debug_ton_manifest():
    return {"url": "https://imagifhub.onrender.com/ton-manifest.json", "status": "ok"}

# Mount static files for ads images (if the folder exists)
if os.path.exists("ads"):
    app.mount("/ads", StaticFiles(directory="ads"), name="ads")
    logging.info("Mounted /ads static directory")
else:
    logging.warning("ads directory not found, static files not mounted")

# Include routers
app.include_router(webhook_router)
app.include_router(invoice_router)
app.include_router(premium_router)
app.include_router(media_router)
app.include_router(admin_router)
app.include_router(ads_router)
app.include_router(ad_trigger_router)
app.include_router(gift_router)          # NEW
app.include_router(ton_router)           # NEW for TON payments

@app.get("/")
async def root():
    return {"status": "IMAGIFHUB API is running"}

# On Render, the public URL is provided in the environment variable RENDER_EXTERNAL_URL
@app.on_event("startup")
async def set_webhook_on_startup():
    public_url = os.environ.get("RENDER_EXTERNAL_URL")
    if public_url:
        webhook_url = f"{public_url}/api/telegram-webhook"
        try:
            await bot.set_webhook(url=webhook_url, drop_pending_updates=True)
            logging.info(f"Webhook set to {webhook_url}")
        except Exception as e:
            logging.error(f"Failed to set webhook: {e}")
    else:
        logging.warning("RENDER_EXTERNAL_URL not set – webhook not configured automatically")

    # Start background pinger (daemon thread so it exits when main process exits)
    def start_pinger():
        ping.run_pinger()
    thread = threading.Thread(target=start_pinger, daemon=True)
    thread.start()
    logging.info("Background pinger started")

    # Start premium expiry checker (async background task)
    asyncio.create_task(run_expiry_checker(interval_hours=6))
    logging.info("Premium expiry checker started")
    
