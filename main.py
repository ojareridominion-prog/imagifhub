from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

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
