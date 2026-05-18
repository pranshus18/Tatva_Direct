# Voice module (inside frontend)

Same React app — **no separate frontend**. Split files for debugging.

## File map

| Symptom | Check file |
|---------|------------|
| Wrong WebSocket URL | `resolveVoiceWsUrl.js` |
| WS connect / messages | `voiceSocket.js` |
| Mic / speech-to-text | `browserSpeech.js` |
| State + wiring | `useVoiceSession.js` |
| UI only | `../pages/VoiceCommerce.jsx` |

## Debug

In browser console:

```js
localStorage.setItem('VOICE_DEBUG', '1')
```

Reload `/voice` — logs prefixed with `[voice]`.

## Run

```bash
cd frontend && npm run dev
```

Backend must be running on port **8081** (`node server.js` or `npm run dev` in `backend/`).

## Vite `ECONNRESET` on ws proxy

If you see `ws proxy socket error: ECONNRESET`, the dev client connects **directly** to
`ws://127.0.0.1:8081/api/voice/ws` (not through Vite). Ensure backend is running before opening `/voice`.
