import logging
import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from websocket.voice_session import run_voice_websocket

settings = get_settings()
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)

app = FastAPI(title="Tatva Voice Commerce Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "voice-agent",
        "gemini_configured": bool(settings.gemini_api_key),
        "tatva_api": settings.tatva_api_base_url,
    }


@app.websocket("/voice")
async def voice_ws(websocket: WebSocket):
    await run_voice_websocket(websocket)


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.voice_ws_host,
        port=settings.voice_ws_port,
        reload=False,
        log_level=settings.log_level.lower(),
    )
