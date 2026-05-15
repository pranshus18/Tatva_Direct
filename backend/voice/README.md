# Voice commerce module (inside backend)

One Node process — **no separate service**. Files are split so you can debug each layer.

## File map (where to look when something breaks)

| Symptom | Check file |
|---------|------------|
| WebSocket won't connect | `voiceWebSocket.js` |
| Auth / token errors | `voiceWebSocket.js` + `authMiddleware` |
| AI wrong / no tools | `geminiOrchestrator.js` |
| Cart / order API errors | `voiceTools.js` |
| HTTP to `/api/po` fails | `internalApiClient.js` |
| "Yes/no" confirm stuck | `confirmations.js` + `sessionMemory.js` |
| FAQ / policy answers | `supportRetriever.js` + `rag/documents/*.md` |
| Stock check | `../controllers/voiceController.js` |

## Flow

```
Browser → WS /api/voice/ws (voiceWebSocket.js)
       → geminiOrchestrator.js
       → voiceTools.js → internalApiClient.js → existing Express routes
```

## Run

```bash
cd backend && npm run dev
```

Requires `GEMINI_API_KEY` in `backend/.env`.

## REST helpers

- `GET /api/voice/health`
- `GET /api/voice/products/:productId/availability`

## Logs

Set `LOG_LEVEL=debug` or watch for `[voice]` in server logs from `geminiOrchestrator.js`.
