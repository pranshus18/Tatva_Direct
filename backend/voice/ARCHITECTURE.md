# Amazon Alexa-Style Voice Commerce Architecture

## Flow

```
Streaming Voice Input (browser STT or Whisper via Python)
    → Intent Router (intent_router.js)
    → FAST: fast_action_executor → ecommerce APIs → short reply
    → SMART: rag_service + gemini_service (streaming) → reply
    → TTS (browser or Piper streaming)
```

## Modules

| Module | Path | Role |
|--------|------|------|
| Intent Router | `services/intent_router.js` | FAST vs SMART before any LLM |
| Fast Action Executor | `services/fast_action_executor.js` | Cart, orders, search — no Gemini/RAG |
| Smart AI Executor | `services/smart_ai_executor.js` | Recommendations, FAQ, guidance |
| Tool Calling Engine | `services/tool_calling_engine.js` | Structured `{ action, slots }` |
| Ecommerce API | `voiceTools.js` + `internalApiClient.js` | Secure REST only |
| RAG Service | `services/rag_service.js` | Policies/FAQ only |
| Gemini Service | `services/gemini_service.js` | Flash + streaming |
| WebSocket Manager | `services/websocket_manager.js` | stt_partial, reply_chunk, tts_chunk |
| AI Orchestrator | `core/ai_orchestrator.js` | Routes FAST vs SMART |
| Whisper Service | `services/whisper_service.js` | Optional Python STT |
| Piper TTS | `services/piper_tts_service.js` | Optional Python TTS |

## Performance targets

- Transactional (FAST): **1–3s**
- Smart (RAG / Gemini): **3–6s**

## Env

See `README.md` and `voice-agent/.env.example`.
