import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import logger from '../../utils/logger.js';
import { SessionMemory, newSessionId } from '../sessionMemory.js';
import { AiOrchestrator } from '../core/ai_orchestrator.js';
import { whisperService } from './whisper_service.js';
import { piperTtsService } from './piper_tts_service.js';
import { ragService } from './rag_service.js';
import { sendVoiceUiNavigate } from './voice_ui_broadcast.js';

const VOICE_WS_PATH = '/api/voice/ws';
const audioBuffers = new WeakMap();

function parseJwt(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function normalizePath(pathname) {
  return String(pathname || '').replace(/\/$/, '') || '/';
}

function sendStatusForUtterance(ws, userText, memory) {
  const pending = memory?.getPendingAction?.();
  const t = String(userText || '').toLowerCase();

  if (
    pending?.type === 'await_pick_product' ||
    pending?.type === 'await_add_quantity' ||
    pending?.type === 'await_discovery_cart_handoff'
  ) {
    send(ws, { type: 'status_message', text: 'Updating your product selection…' });
    return;
  }
  if (pending?.type === 'await_cart_continue') {
    send(ws, { type: 'status_message', text: 'Opening your cart…' });
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  if (pending?.type === 'await_select_supplier') {
    send(ws, { type: 'status_message', text: 'Loading supplier details…' });
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  if (pending?.type === 'await_substitution') {
    send(ws, { type: 'status_message', text: 'Checking substitutions…' });
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  if (pending?.type === 'await_po_details' || pending?.type === 'await_place_confirm') {
    send(ws, { type: 'status_message', text: 'Opening purchase order…' });
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  if (pending?.type === 'await_transport' || /\b(transport|courier|shipping)\b/i.test(t)) {
    send(ws, { type: 'status_message', text: 'Loading transport options… this may take a minute.' });
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  if (
    pending?.type === 'await_place_confirm' ||
    /\b(place (the )?order|confirm order)\b/i.test(t)
  ) {
    send(ws, { type: 'status_message', text: 'Placing your order… please wait.' });
    return;
  }
  if (/\b(search|find|cart|add|product|mac|cement|steel)/i.test(t)) {
    send(ws, { type: 'status_message', text: 'Checking catalog…' });
  }
}

async function streamReply(ws, orchestrator, userText) {
  let fullReply = '';
  const onChunk = (chunk) => {
    fullReply += chunk;
    send(ws, { type: 'reply_chunk', text: chunk });
  };

  const reply = await orchestrator.handleTranscript(userText, { onChunk });
  const finalText = reply || fullReply;

  if (/order is placed/i.test(finalText)) {
    send(ws, {
      type: 'ui_navigate',
      path: '/your-orders',
      label: 'Your orders',
      screen: 'orders'
    });
  } else {
    sendVoiceUiNavigate(ws, orchestrator.memory, { replyText: finalText });
  }

  send(ws, { type: 'reply_done', text: finalText });

  if (piperTtsService.isEnabled() && finalText) {
    send(ws, { type: 'agent_state', state: 'speaking' });
    await piperTtsService.streamSpeak(finalText, (chunk) => {
      send(ws, { type: 'tts_chunk', chunk });
    });
  }

  return finalText;
}

export function attachVoiceWebSocket(server) {
  ragService.warm();

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = normalizePath(new URL(request.url || '/', 'http://localhost').pathname);
    if (pathname !== VOICE_WS_PATH) return;

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('error', (err) => logger.warn('[voice] ws error:', err.message));

    const sessionId = newSessionId();
    const memory = new SessionMemory(sessionId);
    let orchestrator = null;
    let busy = false;
    audioBuffers.set(ws, []);

    send(ws, {
      type: 'ready',
      sessionId,
      pipeline: {
        whisper: whisperService.isEnabled(),
        piper: piperTtsService.isEnabled(),
        streaming: true
      }
    });

    ws.on('message', (raw) => {
      void (async () => {
        if (busy) {
          send(ws, { type: 'error', code: 'busy', message: 'Still processing' });
          return;
        }

        let data;
        try {
          data = JSON.parse(String(raw));
        } catch {
          send(ws, { type: 'error', code: 'invalid_json' });
          return;
        }

        const type = data.type;

        if (type === 'auth') {
          const decoded = parseJwt(data.token);
          if (!decoded?.id) {
            send(ws, { type: 'error', code: 'auth_failed', message: 'Invalid token' });
            return;
          }
          orchestrator = new AiOrchestrator(data.token, memory);
          send(ws, { type: 'auth_ok', sessionId });
          send(ws, { type: 'agent_state', state: 'listening' });
          return;
        }

        if (type === 'call_start' && orchestrator) {
          const flow = String(data.flow || '').toLowerCase();
          if (flow === 'cart') {
            const { beginCartCheckoutSession } = await import('./checkout_flow.js');
            await beginCartCheckoutSession(orchestrator.toolCtx, memory);
            sendVoiceUiNavigate(ws, memory);
          } else if (flow === 'discovery') {
            const { enterDiscoveryFlow } = await import('../lib/voice_flow_mode.js');
            enterDiscoveryFlow(memory);
          }
          return;
        }

        if (!orchestrator) {
          send(ws, { type: 'error', code: 'not_authenticated' });
          return;
        }

        if (type === 'audio' && data.chunk) {
          const buf = audioBuffers.get(ws) || [];
          buf.push(data.chunk);
          audioBuffers.set(ws, buf);

          if (whisperService.isEnabled() && data.partial) {
            const { partial } = await whisperService.transcribePcmBase64(data.chunk, { final: false });
            if (partial) send(ws, { type: 'stt_partial', text: partial });
          }
          return;
        }

        if (type === 'end_utterance') {
          busy = true;
          const t0 = Date.now();
          try {
            let userText = String(data.text || '').trim();
            const buf = audioBuffers.get(ws) || [];
            audioBuffers.set(ws, []);

            if (!userText && buf.length && whisperService.isEnabled()) {
              const combined = buf.join('');
              const { text, partial } = await whisperService.transcribePcmBase64(combined, { final: true });
              if (partial) send(ws, { type: 'stt_partial', text: partial });
              userText = text?.trim() || '';
            }

            if (!userText) {
              send(ws, { type: 'agent_reply', text: "I didn't hear anything. Please try again." });
              send(ws, { type: 'agent_state', state: 'listening' });
              return;
            }

            send(ws, { type: 'stt_final', text: userText });
            send(ws, { type: 'final_transcript', text: userText });
            send(ws, { type: 'agent_state', state: 'thinking' });
            sendStatusForUtterance(ws, userText, memory);

            const finalText = await streamReply(ws, orchestrator, userText);
            send(ws, { type: 'agent_reply', text: finalText });
            send(ws, { type: 'call_active', inCall: true });

            if (process.env.VOICE_DEBUG === 'true') {
              logger.info(`[voice] total ${Date.now() - t0}ms`);
            }
            send(ws, { type: 'agent_state', state: 'listening' });
          } catch (err) {
            logger.error('[voice] pipeline:', err);
            send(ws, { type: 'error', code: 'pipeline_error', message: err.message });
            send(ws, { type: 'agent_state', state: 'listening' });
          } finally {
            busy = false;
          }
          return;
        }

        if (type === 'text') {
          const userText = String(data.text || '').trim();
          if (!userText) return;

          busy = true;
          const t0 = Date.now();
          try {
            send(ws, { type: 'stt_final', text: userText });
            send(ws, { type: 'final_transcript', text: userText });
            send(ws, { type: 'agent_state', state: 'thinking' });
            sendStatusForUtterance(ws, userText, memory);

            const finalText = await streamReply(ws, orchestrator, userText);
            send(ws, { type: 'agent_reply', text: finalText });
            send(ws, { type: 'call_active', inCall: true });

            if (process.env.VOICE_DEBUG === 'true') {
              logger.info(`[voice] text ${Date.now() - t0}ms`);
            }
            send(ws, { type: 'agent_state', state: 'listening' });
          } catch (err) {
            logger.error('[voice] text:', err);
            send(ws, { type: 'error', code: 'pipeline_error', message: err.message });
          } finally {
            busy = false;
          }
          return;
        }

        send(ws, { type: 'error', code: 'unknown_message_type' });
      })();
    });

    ws.on('close', () => audioBuffers.delete(ws));
  });

  const interval = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  logger.info(`[voice] WebSocket ${VOICE_WS_PATH} (streaming, alexa-router)`);
  return wss;
}
