import json
import logging
from typing import AsyncIterator

import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import get_settings
from pipeline.audio_utils import decode_pcm16_base64, encode_pcm16_base64
from pipeline.stt_whisper import transcribe_audio, transcribe_streaming
from pipeline.tts_piper import synthesize_speech, synthesize_speech_chunks
from websocket.voice_session import run_voice_websocket

settings = get_settings()
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)

app = FastAPI(title="Tatva Voice Pipeline", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SAMPLE_RATE = 16000


class SttRequest(BaseModel):
    chunk: str = ""
    final: bool = False


class TtsRequest(BaseModel):
    text: str = ""


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "voice-agent",
        "whisper_model": settings.whisper_model,
        "gemini_configured": bool(settings.gemini_api_key),
    }


@app.post("/stt")
async def stt_endpoint(body: SttRequest):
    """Faster-Whisper STT — base.en / small.en optimized for latency."""
    if not body.chunk:
        return {"text": "", "partial": ""}
    samples = decode_pcm16_base64(body.chunk, SAMPLE_RATE)
    if body.final:
        text, partial = transcribe_audio(samples, SAMPLE_RATE)
    else:
        text, partial = transcribe_streaming(samples, SAMPLE_RATE)
    return {"text": text, "partial": partial}


async def tts_ndjson_stream(text: str) -> AsyncIterator[bytes]:
    for chunk_b64 in synthesize_speech_chunks(text):
        yield (json.dumps({"chunk": chunk_b64}) + "\n").encode("utf-8")


@app.post("/tts/stream")
async def tts_stream_endpoint(body: TtsRequest):
    """Streaming Piper TTS — chunked PCM16 for immediate playback."""
    clean = (body.text or "").strip()
    if not clean:
        return StreamingResponse(iter([b""]), media_type="application/x-ndjson")

    return StreamingResponse(tts_ndjson_stream(clean), media_type="application/x-ndjson")


@app.post("/tts")
async def tts_endpoint(body: TtsRequest):
    audio = synthesize_speech(body.text)
    if audio is None or len(audio) == 0:
        return {"chunk": ""}
    return {"chunk": encode_pcm16_base64(audio)}


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
