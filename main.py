from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import logging
import os
import threading
import asyncio
from pathlib import Path

# ---- Logging ----
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---- Environment flag ----
IS_RENDER = os.environ.get("RENDER") == "true"   # set on Render

# ---- FastAPI app ----
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Import routers ----
from invoice import router as invoice_router
from premium import router as premium_router
from media import router as media_router
from ads_router import router as ads_router
from gift_routes import router as gift_router
from ton_routes import router as ton_router
from saved_routes import router as saved_router
from music_routes import router as music_router

# Include user‑facing routers (always)
app.include_router(invoice_router)
app.include_router(premium_router)
app.include_router(media_router)
app.include_router(ads_router)
app.include_router(gift_router)
app.include_router(ton_router)
app.include_router(saved_router)
app.include_router(music_router)

# ---- Render‑only: admin, bot, ad_trigger ----
if IS_RENDER:
    # Import Render‑specific modules only on Render
    from webhook import router as webhook_router
    from admin import router as admin_router
    from ad_trigger import router as ad_trigger_router
    import bot_handlers  # registers handlers with dp
    from premium_expiry_checker import run_expiry_checker
    from config import bot, dp
    import ping

    app.include_router(webhook_router)
    app.include_router(admin_router)
    app.include_router(ad_trigger_router)

    # ---- Mount static folders (optional, but keep for safety) ----
    BASE_DIR = Path(__file__).resolve().parent
    assets_dir = BASE_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
    ads_dir = BASE_DIR / "ads"
    if ads_dir.exists():
        app.mount("/ads", StaticFiles(directory=str(ads_dir)), name="ads")

    @app.get("/")
    async def root():
        return {"status": "IMAGIFHUB API (Render) is running"}

    # ---- Startup tasks (only on Render) ----
    @app.on_event("startup")
    async def startup_render():
        public_url = os.environ.get("RENDER_EXTERNAL_URL")
        if public_url:
            webhook_url = f"{public_url}/api/telegram-webhook"
            try:
                await bot.set_webhook(url=webhook_url, drop_pending_updates=True)
                logger.info(f"Webhook set to {webhook_url}")
            except Exception as e:
                logger.error(f"Failed to set webhook: {e}")
        else:
            logger.warning("RENDER_EXTERNAL_URL not set – webhook not configured automatically")

        # Start background pinger
        def start_pinger():
            ping.run_pinger()
        thread = threading.Thread(target=start_pinger, daemon=True)
        thread.start()
        logger.info("Background pinger started")

        # Start premium expiry checker
        asyncio.create_task(run_expiry_checker(interval_hours=6))
        logger.info("Premium expiry checker started")

else:
    # ---- Vercel: serve static frontend ----
    BASE_DIR = Path(__file__).resolve().parent
    # Serve root index.html and all static assets
    app.mount("/", StaticFiles(directory=str(BASE_DIR), html=True), name="static")

    @app.get("/")
    async def root():
        # This will be overridden by the static mount, but just in case
        return {"status": "IMAGIFHUB API (Vercel) is running"}

    # ---- Optional: TON manifest (already served via route) ----
    @app.get("/ton-manifest.json")
    async def ton_manifest(request: Request):
        base_url = str(request.base_url).rstrip('/')
        return {
            "url": "https://ojareridominion-prog.github.io/imagifhub",
            "name": "IMAGIFHUB",
            "iconUrl": "https://ojareridominion-prog.github.io/imagifhub/assets/icon.png"
        }
        
