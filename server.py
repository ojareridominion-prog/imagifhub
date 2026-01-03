from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
import uvicorn
import asyncio
from api import api_app
import main

# Create main app
app = FastAPI()

# Mount API app
app.mount("/api", api_app)

# Route specific endpoints
@app.post("/api/telegram-webhook")
async def telegram_webhook(request: Request):
    return await main.handle_webhook(request)

@app.get("/api/set-webhook")
async def set_webhook(request: Request):
    return await main.set_webhook(request)

@app.get("/media")
async def media_endpoint(category: str = "all", search: str = ""):
    data = await main.get_media(category, search)
    return JSONResponse(content=data)

# Serve frontend files
@app.get("/")
async def serve_index():
    return FileResponse("index.html")

@app.get("/{filename}")
async def serve_static(filename: str):
    if filename.endswith(('.js', '.css', '.html', '.png', '.jpg', '.jpeg')):
        return FileResponse(filename)
    return FileResponse("index.html")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
