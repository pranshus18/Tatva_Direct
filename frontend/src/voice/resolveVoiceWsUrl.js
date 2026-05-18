import { getApiUrl } from '../config/api';

/**
 * WebSocket URL for integrated backend voice (same host as API in production).
 */
export function resolveVoiceWsUrl() {
  if (import.meta.env.VITE_VOICE_WS_URL) {
    return import.meta.env.VITE_VOICE_WS_URL;
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (import.meta.env.DEV && (host === 'localhost' || host === '127.0.0.1')) {
      // Direct to backend avoids Vite ws-proxy ECONNRESET; set VITE_VOICE_WS_URL to force proxy.
      const port = import.meta.env.VITE_BACKEND_PORT || '8081';
      return `ws://127.0.0.1:${port}/api/voice/ws`;
    }
    const api = getApiUrl('');
    const base = api.replace(/^http/, 'ws').replace(/\/$/, '');
    return `${base}/api/voice/ws`;
  }
  return 'ws://localhost:8081/api/voice/ws';
}
