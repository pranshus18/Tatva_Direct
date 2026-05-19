import { resolveVoiceWsUrl } from './resolveVoiceWsUrl.js';

/**
 * Streaming WebSocket client — Alexa-style protocol.
 * Events: stt_partial, stt_final, reply_chunk, reply_done, tts_chunk, agent_reply
 */
export function createVoiceSocket({ token, handlers }) {
  const ws = new WebSocket(resolveVoiceWsUrl());
  const audioChunks = [];

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

    if (data.type === 'stt_partial') handlers.onSttPartial?.(data.text);
    if (data.type === 'stt_final' || data.type === 'final_transcript') {
      handlers.onSttFinal?.(data.text);
    }
    if (data.type === 'reply_chunk') handlers.onReplyChunk?.(data.text);
    if (data.type === 'reply_done') handlers.onReplyDone?.(data.text);
    if (data.type === 'tts_chunk') handlers.onTtsChunk?.(data.chunk);
    if (data.type === 'agent_reply') handlers.onAgentReply?.(data.text);
    if (data.type === 'agent_state') handlers.onAgentState?.(data.state);
    if (data.type === 'auth_ok') handlers.onAuthOk?.(data);
    if (data.type === 'ready') handlers.onReady?.(data);
    if (data.type === 'error') handlers.onError?.(data);
    if (data.type === 'ui_navigate') handlers.onUiNavigate?.(data);

    handlers.onMessage?.(data);
  };

  ws.onerror = () => {
    handlers.onError?.({
      code: 'connection_failed',
      message: 'Could not connect to voice service. Is the backend running?'
    });
  };

  let closedIntentionally = false;

  ws.onclose = (event) => {
    handlers.onClose?.({ intentional: closedIntentionally, code: event.code });
  };

  return {
    sendText(text) {
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ type: 'text', text: String(text).trim() }));
      return true;
    },

    sendCallStart(flow) {
      if (ws.readyState !== WebSocket.OPEN) return false;
      const f = String(flow || '').trim();
      if (!f) return false;
      ws.send(JSON.stringify({ type: 'call_start', flow: f }));
      return true;
    },

    sendAudioChunk(chunkBase64, { partial = true } = {}) {
      if (ws.readyState !== WebSocket.OPEN) return false;
      audioChunks.push(chunkBase64);
      ws.send(JSON.stringify({ type: 'audio', chunk: chunkBase64, partial }));
      return true;
    },

    endUtterance(text = '') {
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(
        JSON.stringify({
          type: 'end_utterance',
          text: String(text || '').trim()
        })
      );
      audioChunks.length = 0;
      return true;
    },

    close() {
      closedIntentionally = true;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'client close');
      }
    },

    get readyState() {
      return ws.readyState;
    }
  };
}
