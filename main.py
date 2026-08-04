from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import logging
import os
import threading
import asyncio
from pathlib import Path

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
from gift_routes import router as gift_router
from ton_routes import router as ton_router
from saved_routes import router as saved_router

# Import bot handlers to register them with dispatcher
import bot_handlers  # noqa

# Import premium expiry checker
from premium_expiry_checker import run_expiry_checker

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========== STATIC FILES SERVING ==========
BASE_DIR = Path(__file__).resolve().parent

# Serve assets folder (for icon.png, holiday images, etc.)
assets_dir = BASE_DIR / "assets"
if assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
    logging.info("Mounted /assets static directory")
else:
    logging.warning("assets directory not found – static files not mounted")

# Serve ads folder (for native ad images)
ads_dir = BASE_DIR / "ads"
if ads_dir.exists():
    app.mount("/ads", StaticFiles(directory=str(ads_dir)), name="ads")
    logging.info("Mounted /ads static directory")
else:
    logging.warning("ads directory not found – static files not mounted")

# ========== TON MANIFEST ENDPOINT ==========
# This serves the manifest for TonConnect UI.
# No need for a separate physical file – it's generated dynamically.
@app.get("/ton-manifest.json")
async def ton_manifest(request: Request):
    base_url = str(request.base_url).rstrip('/')
    return {
        "url": "https://ojareridominion-prog.github.io/imagifhub",
        "name": "IMAGIFHUB",
        "iconUrl": "https://ojareridominion-prog.github.io/imagifhub/assets/icon.png"
    }
# Optional debug endpoint
@app.get("/debug/ton-manifest")
async def debug_ton_manifest():
    return {"url": "https://imagifhub.onrender.com/ton-manifest.json", "status": "ok"}

# ========== INCLUDE ROUTERS ==========
app.include_router(webhook_router)
app.include_router(invoice_router)
app.include_router(premium_router)
app.include_router(media_router)
app.include_router(admin_router)
app.include_router(ads_router)
app.include_router(ad_trigger_router)
app.include_router(gift_router)
app.include_router(ton_router)
app.include_router(saved_router)

@app.get("/")
async def root():
    return {"status": "IMAGIFHUB API is running"}

# ========== STARTUP EVENTS ==========
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

    # Start background pinger (daemon thread)
    def start_pinger():
        ping.run_pinger()
    thread = threading.Thread(target=start_pinger, daemon=True)
    thread.start()
    logging.info("Background pinger started")

    # Start premium expiry checker (async background task)
    asyncio.create_task(run_expiry_checker(interval_hours=6))
    logging.info("Premium expiry checker started")
    
