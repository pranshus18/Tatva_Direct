# Voice Pipeline (Whisper + Piper)

Optional Python service for **streaming STT/TTS**. Node backend (`8081`) remains the commerce brain.

## Setup

```bash
cd voice-agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Set GEMINI_API_KEY, PIPER_VOICE path
python main.py
```

## Models

- **Whisper:** `base.en` or `small.en` (low latency). Do **not** use `large-v3`.
- **Gemini:** `gemini-1.5-flash` for agent in Python WS mode.
- **Piper:** install voice `.onnx` and set `PIPER_VOICE`.

## HTTP API (used by Node)

| Endpoint | Purpose |
|----------|---------|
| `POST /stt` | `{ chunk, final }` → `{ text, partial }` |
| `POST /tts/stream` | NDJSON `{ chunk: base64_pcm }` |
| `GET /health` | Status |

## Node integration

In `backend/.env`:

```env
VOICE_PYTHON_URL=http://127.0.0.1:8765
```

Restart Node backend — WebSocket `ready` payload shows `whisper: true`, `piper: true`.

## WebSocket (standalone)

`ws://localhost:8765/voice` — full Python pipeline (legacy).

Recommended: **browser STT + Node router** (no Python required) or **Python only for TTS/STT** with Node orchestration.
