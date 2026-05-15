import asyncio
import json
import logging
from typing import Optional

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from agent.memory import SessionMemory, new_session_id
from agent.orchestrator import VoiceOrchestrator
from config import get_settings
from pipeline.audio_utils import decode_pcm16_base64, encode_pcm16_base64
from pipeline.stt_whisper import transcribe_audio
from pipeline.tts_piper import synthesize_speech

logger = logging.getLogger(__name__)
SAMPLE_RATE = 16000


class VoiceSession:
    def __init__(self, websocket: WebSocket):
        self.ws = websocket
        self.session_id = new_session_id()
        self.memory = SessionMemory(self.session_id)
        self.token: Optional[str] = None
        self.orchestrator: Optional[VoiceOrchestrator] = None
        self._audio_buffer: list[np.ndarray] = []
        self._processing = False

    async def send_json(self, payload: dict) -> None:
        await self.ws.send_text(json.dumps(payload))

    async def send_state(self, state: str) -> None:
        await self.send_json({"type": "agent_state", "state": state})

    async def send_error(self, code: str, message: str = "") -> None:
        await self.send_json({"type": "error", "code": code, "message": message})

    async def send_audio_chunks(self, audio: np.ndarray, chunk_samples: int = 8000) -> None:
        if audio is None or len(audio) == 0:
            return
        for i in range(0, len(audio), chunk_samples):
            chunk = audio[i : i + chunk_samples]
            await self.send_json({"type": "audio", "chunk": encode_pcm16_base64(chunk)})

    async def handle_auth(self, token: str) -> bool:
        token = (token or "").strip()
        if not token:
            await self.send_error("auth_required", "Token is required")
            return False
        self.token = token
        try:
            self.orchestrator = VoiceOrchestrator(token, self.memory)
        except Exception as exc:
            await self.send_error("auth_failed", str(exc))
            return False
        await self.send_json({"type": "auth_ok", "sessionId": self.session_id})
        return True

    async def flush_audio_and_respond(self) -> None:
        if self._processing or not self.orchestrator:
            return
        if not self._audio_buffer:
            return

        self._processing = True
        await self.send_state("thinking")
        try:
            audio = np.concatenate(self._audio_buffer)
            self._audio_buffer.clear()

            text, partial = transcribe_audio(audio, SAMPLE_RATE)
            if partial:
                await self.send_json({"type": "partial_transcript", "text": partial})

            if not text:
                await self.send_json({"type": "final_transcript", "text": ""})
                reply = "I didn't hear anything. Please speak again."
            else:
                await self.send_json({"type": "final_transcript", "text": text})
                reply = await self.orchestrator.handle_transcript(text)

            await self.send_json({"type": "agent_reply", "text": reply})

            await self.send_state("speaking")
            tts_audio = synthesize_speech(reply)
            if tts_audio is not None and len(tts_audio) > 0:
                await self.send_audio_chunks(tts_audio)
            else:
                await self.send_json({"type": "tts_unavailable", "text": reply})

            await self.send_state("listening")
        except Exception as exc:
            logger.exception("Voice pipeline error: %s", exc)
            await self.send_error("pipeline_error", "Processing failed")
        finally:
            self._processing = False

    async def on_audio_chunk(self, chunk_b64: str) -> None:
        if not self.orchestrator:
            await self.send_error("not_authenticated")
            return
        samples = decode_pcm16_base64(chunk_b64, SAMPLE_RATE)
        if len(samples) > 0:
            self._audio_buffer.append(samples)

    async def on_end_of_utterance(self) -> None:
        await self.flush_audio_and_respond()

    async def on_text_message(self, data: dict) -> None:
        msg_type = data.get("type")
        if msg_type == "auth":
            await self.handle_auth(data.get("token", ""))
            return
        if msg_type == "audio":
            await self.on_audio_chunk(data.get("chunk", ""))
            return
        if msg_type == "end_utterance":
            await self.on_end_of_utterance()
            return
        if msg_type == "text":
            if not self.orchestrator:
                await self.send_error("not_authenticated")
                return
            await self.send_state("thinking")
            reply = await self.orchestrator.handle_transcript(data.get("text", ""))
            await self.send_json({"type": "agent_reply", "text": reply})
            await self.send_state("speaking")
            tts_audio = synthesize_speech(reply)
            if tts_audio is not None:
                await self.send_audio_chunks(tts_audio)
            await self.send_state("listening")
            return
        await self.send_error("unknown_message_type")


async def run_voice_websocket(websocket: WebSocket) -> None:
    settings = get_settings()
    origin = websocket.headers.get("origin")
    if origin and settings.cors_origin_list and origin not in settings.cors_origin_list:
        if settings.cors_origin_list != ["*"]:
            await websocket.close(code=1008)
            return

    await websocket.accept()
    session = VoiceSession(websocket)
    await session.send_json({"type": "ready", "sessionId": session.session_id})

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await session.send_error("invalid_json")
                continue
            await session.on_text_message(data)
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected session=%s", session.session_id)
    except Exception as exc:
        logger.exception("WebSocket error: %s", exc)
        try:
            await session.send_error("internal_error")
        except Exception:
            pass
