# Voice Commerce — Amazon Alexa-Style

## Architecture

```
Voice → Intent Router → FAST (API only) | SMART (RAG + Gemini Flash)
                     → Streaming WebSocket → TTS
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module map.

## Run (integrated — recommended)

```bash
# Terminal 1
cd backend && node server.js

# Terminal 2
cd frontend && npm run dev
```

Login as **service_provider** → `/voice`

## Env (`backend/.env`)

```env
GEMINI_API_KEY=...
JWT_SECRET=...

# Speed (voice ignores GEMINI_MODEL=pro unless VOICE_USE_APP_GEMINI_MODEL=true)
VOICE_GEMINI_MODEL=gemini-1.5-flash
VOICE_MAX_TOOL_ROUNDS=1
VOICE_MAX_OUTPUT_TOKENS=96
VOICE_DEBUG=true

# Optional Whisper + Piper (run voice-agent on 8765)
VOICE_PYTHON_URL=http://127.0.0.1:8765
```

## Optional Python pipeline

```bash
cd voice-agent && pip install -r requirements.txt && python main.py
```

Uses `base.en` Whisper + Piper streaming. Node proxies `/stt` and `/tts/stream`.

## Routing rules

| User says | Path | Gemini? | RAG? |
|-----------|------|---------|------|
| Add X to cart | FAST | No | No |
| Show my cart | FAST | No | No |
| Checkout | FAST | No | No |
| Track order | FAST | No | No |
| Refund policy | SMART | No | Yes |
| Recommend products | SMART | Yes | Maybe |
| Vague chat | SMART | Yes | Maybe |

## WebSocket events

- `stt_partial`, `stt_final`
- `reply_chunk`, `reply_done`, `agent_reply`
- `tts_chunk` (Piper)
- `agent_state`: listening | thinking | speaking

## Debug

`localStorage.setItem('VOICE_DEBUG','1')` in browser console.
