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
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/api/voice/ws`;
    }
    const api = getApiUrl('');
    const base = api.replace(/^http/, 'ws').replace(/\/$/, '');
    return `${base}/api/voice/ws`;
  }
  return 'ws://localhost:8081/api/voice/ws';
}
