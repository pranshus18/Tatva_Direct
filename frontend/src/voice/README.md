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

Backend must be running (`npm run dev` in `backend/`).
