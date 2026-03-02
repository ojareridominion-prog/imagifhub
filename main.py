from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import os
import asyncio
from config import bot, dp  # <-- add this import

# Import routers
from webhook import router as webhook_router
from invoice import router as invoice_router
from premium import router as premium_router
from media import router as media_router
from admin import router as admin_router

# Import bot handlers to register them with dispatcher
import bot_handlers  # noqa

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# Include routers
app.include_router(webhook_router)
app.include_router(invoice_router)
app.include_router(premium_router)
app.include_router(media_router)
app.include_router(admin_router)

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
