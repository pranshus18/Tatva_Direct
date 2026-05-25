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

# Voice chat uses GEMINI_MODEL from .env (e.g. gemini-2.5-pro). Override only for voice:
# VOICE_GEMINI_MODEL=gemini-2.5-flash
# VOICE_GEMINI_TIMEOUT_MS=22000   # optional; pro gets 22s default if unset
VOICE_MAX_TOOL_ROUNDS=1
VOICE_MAX_OUTPUT_TOKENS=96
VOICE_DEBUG=true
```

**Speech (TTS):** One **server-side Edge neural voice** per language (variant 2: Prabhat / Madhur / Gagan / Mohan). Users do **not** need to download OS voices. Browser `speechSynthesis` is only a fallback if server TTS fails.

```env
VOICE_EDGE_TTS=true
VOICE_EDGE_VOICE_VARIANT=2   # 2 = product accent (default); 1 = Neerja/Swara set
VOICE_TTS_PROVIDER=edge        # edge | gemini — keep edge for consistent accent
```

Set `VOICE_PYTHON_URL` only if you run a separate service that exposes `POST /stt` and `POST /tts/stream`.

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
- `tts_chunk` (optional external TTS)
- `agent_state`: listening | thinking | speaking

## Debug

`localStorage.setItem('VOICE_DEBUG','1')` in browser console.
