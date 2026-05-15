import { resolveVoiceWsUrl } from './resolveVoiceWsUrl.js';

/**
 * Thin WebSocket client for /api/voice/ws protocol.
 */
export function createVoiceSocket({ token, handlers }) {
  const ws = new WebSocket(resolveVoiceWsUrl());

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', token }));
    handlers.onOpen?.();
  };

  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      handlers.onError?.({ code: 'invalid_json', message: 'Invalid server message' });
      return;
    }
    handlers.onMessage?.(data);
  };

  ws.onerror = () => {
    handlers.onError?.({
      code: 'connection_failed',
      message: 'Could not connect to voice service. Is the backend running?'
    });
  };

  ws.onclose = () => {
    handlers.onClose?.();
  };

  return {
    sendText(text) {
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ type: 'text', text: String(text).trim() }));
      return true;
    },
    close() {
      ws.close();
    },
    get readyState() {
      return ws.readyState;
    }
  };
}
