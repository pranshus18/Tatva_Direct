import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';
import { VoiceOrchestrator } from './geminiOrchestrator.js';
import { SessionMemory, newSessionId } from './sessionMemory.js';

const sessions = new Map();

function parseJwt(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function attachVoiceWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, path: '/api/voice/ws' });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== '/api/voice/ws') return;

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    const sessionId = newSessionId();
    const memory = new SessionMemory(sessionId);
    let orchestrator = null;

    send(ws, { type: 'ready', sessionId });

    ws.on('message', async (raw) => {
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
        orchestrator = new VoiceOrchestrator(data.token, memory);
        sessions.set(sessionId, { ws, orchestrator });
        send(ws, { type: 'auth_ok', sessionId });
        send(ws, { type: 'agent_state', state: 'listening' });
        return;
      }

      if (!orchestrator) {
        send(ws, { type: 'error', code: 'not_authenticated' });
        return;
      }

      if (type === 'text' || type === 'end_utterance') {
        const userText = String(data.text || '').trim();
        if (!userText && type === 'end_utterance') {
          send(ws, { type: 'agent_reply', text: "I didn't hear anything. Please try again." });
          send(ws, { type: 'agent_state', state: 'listening' });
          return;
        }
        if (!userText) return;

        try {
          send(ws, { type: 'final_transcript', text: userText });
          send(ws, { type: 'agent_state', state: 'thinking' });
          const reply = await orchestrator.handleTranscript(userText);
          send(ws, { type: 'agent_reply', text: reply });
          send(ws, { type: 'agent_state', state: 'listening' });
        } catch (err) {
          logger.error('[voice] handle error:', err);
          send(ws, { type: 'error', code: 'pipeline_error', message: err.message });
          send(ws, { type: 'agent_state', state: 'listening' });
        }
        return;
      }

      if (type === 'audio') {
        send(ws, {
          type: 'error',
          code: 'use_browser_stt',
          message: 'Server uses browser speech recognition. Send type:text after STT.'
        });
        return;
      }

      send(ws, { type: 'error', code: 'unknown_message_type' });
    });

    ws.on('close', () => {
      sessions.delete(sessionId);
    });
  });

  logger.info('Voice WebSocket attached at /api/voice/ws');
  return wss;
}
