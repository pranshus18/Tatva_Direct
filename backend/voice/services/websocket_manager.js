import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import logger from '../../utils/logger.js';
import { SessionMemory, newSessionId } from '../sessionMemory.js';
import { AiOrchestrator } from '../core/ai_orchestrator.js';
import { whisperService } from './whisper_service.js';
import { voiceTtsService } from './voice_tts_service.js';
import { edgeTtsService } from './edge_tts_service.js';
import { ragService } from './rag_service.js';
import { sendVoiceUiNavigate } from './voice_ui_broadcast.js';
import { hasMandatoryTransportSelected } from '../lib/transportGate.js';
import {
  normalizeVoiceLanguage,
  parseVoiceLanguageFromText,
  resolveDefaultVoiceLanguage,
  resolveVoiceLanguage,
  withVoiceLanguage,
  isVoiceMultilingualEnabled
} from '../lib/voiceLanguage.js';
import { voiceText } from '../lib/voiceText.js';
import {
  isLikelySpeechNoise,
  normalizeVoiceUtterance
} from '../lib/normalizeVoiceUtterance.js';

function safePipelineUserMessage(memory) {
  return voiceText(memory, 'error.pipeline');
}

function prepareUserTranscript(memory, raw) {
  const text = normalizeVoiceUtterance(String(raw || '').trim());
  if (!text) return { text: '', noise: false };
  if (isLikelySpeechNoise(text)) {
    return { text: '', noise: true, reply: voiceText(memory, 'stt.didNotCatch') };
  }
  return { text, noise: false };
}

/** Single-word language choice — skip status noise and use fast TTS path. */
function isLanguagePickUtterance(memory, text) {
  const pick = parseVoiceLanguageFromText(text);
  if (!pick) return false;
  if (!memory?.isVoiceLanguageSelected?.()) return true;
  return /^(english|hinglish|hindi|kannada|telugu)$/i.test(String(text || '').trim());
}

const VOICE_WS_PATH = '/api/voice/ws';
const audioBuffers = new WeakMap();
const wsVoiceState = new WeakMap();

const STATUS_WAIT_MS =
  Number.parseInt(String(process.env.VOICE_STATUS_WAIT_MS || '550'), 10) || 550;

/** Only these get immediate spoken status (slow API steps). Others are UI text only. */
const SLOW_STATUS_KEYS = new Set(['status.transport', 'status.transportStill', 'status.order']);

const TRANSPORT_STILL_MS =
  Number.parseInt(String(process.env.VOICE_TRANSPORT_STILL_MS || '12000'), 10) || 12000;

function voiceConn(ws) {
  if (!wsVoiceState.has(ws)) {
    wsVoiceState.set(ws, {
      politeWaitTimer: null,
      statusSpokenTurn: false,
      ttsChain: Promise.resolve(),
      ttsSeq: 0
    });
  }
  return wsVoiceState.get(ws);
}

/** One spoken line at a time — prevents status + reply audio overlapping. */
function enqueueWsTts(ws, job) {
  const st = voiceConn(ws);
  st.ttsChain = st.ttsChain.then(() => job()).catch((err) => {
    logger.warn('[voice] TTS queue:', err?.message || err);
  });
  return st.ttsChain;
}

function clearPoliteWaitTimer(ws) {
  const st = voiceConn(ws);
  if (st.politeWaitTimer) {
    clearTimeout(st.politeWaitTimer);
    st.politeWaitTimer = null;
  }
}

/** Status on screen; optional short TTS for slow steps only. */
function sendStatusMessage(ws, memory, key, { speak = SLOW_STATUS_KEYS.has(key) } = {}) {
  const text = voiceText(memory, key);
  if (!text?.trim()) return;
  send(ws, { type: 'status_message', text, speak: Boolean(speak) });
  if (speak && voiceTtsService.isEnabled()) {
    const st = voiceConn(ws);
    st.statusSpokenTurn = true;
    void streamReplyTts(ws, text, resolveVoiceLanguage(memory), { fast: true, statusLine: true });
  }
}

function armPoliteWait(ws, memory, isBusy) {
  const st = voiceConn(ws);
  clearPoliteWaitTimer(ws);
  const pendingType = memory?.getPendingAction?.()?.type;
  if (pendingType === 'await_transport' || pendingType === 'await_po_details') {
    return;
  }
  st.politeWaitTimer = setTimeout(() => {
    st.politeWaitTimer = null;
    if (!isBusy() || st.statusSpokenTurn) return;
    sendStatusMessage(ws, memory, 'status.pleaseWait', { speak: true });
  }, STATUS_WAIT_MS);
}

/** Lets checkout code speak/UI status while courier quotes load (30s–2min). */
export function attachVoiceStatusEmitter(ws, memory, toolCtx) {
  if (!toolCtx) return;
  toolCtx.emitStatus = (key, opts = {}) => {
    sendStatusMessage(ws, memory, key, opts);
  };
  toolCtx.armTransportStillWait = () => {
    if (toolCtx._transportStillTimer) clearTimeout(toolCtx._transportStillTimer);
    toolCtx._transportStillTimer = setTimeout(() => {
      toolCtx._transportStillTimer = null;
      if (toolCtx.emitStatus) {
        sendStatusMessage(ws, memory, 'status.transportStill', { speak: false });
      }
    }, TRANSPORT_STILL_MS);
  };
  toolCtx.clearTransportStillWait = () => {
    if (toolCtx._transportStillTimer) {
      clearTimeout(toolCtx._transportStillTimer);
      toolCtx._transportStillTimer = null;
    }
  };
}

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
  if (
    isVoiceMultilingualEnabled() &&
    memory &&
    !memory.isVoiceLanguageSelected?.() &&
    parseVoiceLanguageFromText(userText)
  ) {
    return;
  }

  const pending = memory?.getPendingAction?.();
  const t = String(userText || '').toLowerCase();

  if (pending?.type === 'await_pick_product' || pending?.type === 'await_add_quantity') {
    sendStatusMessage(ws, memory, 'status.updatingProduct');
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  if (pending?.type === 'await_discovery_cart_handoff') {
    sendStatusMessage(ws, memory, 'status.openingCart');
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  if (pending?.type === 'await_cart_continue') {
    sendStatusMessage(ws, memory, 'status.openingCart');
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  if (pending?.type === 'await_select_supplier') {
    sendStatusMessage(ws, memory, 'status.loadingSupplier');
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  if (pending?.type === 'await_substitution') {
    sendStatusMessage(ws, memory, 'status.checkingSubstitution');
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  if (pending?.type === 'await_po_details' || pending?.type === 'await_place_confirm') {
    sendStatusMessage(ws, memory, 'status.openingPo');
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  const checkout = memory?.getContext?.('checkout', {}) || {};
  if (hasMandatoryTransportSelected(checkout)) {
    if (pending?.type === 'await_place_confirm' || pending?.type === 'await_transport') {
      sendStatusMessage(ws, memory, 'status.openingPo');
      sendVoiceUiNavigate(ws, memory);
      return;
    }
  }

  if (pending?.type === 'await_transport') {
    sendStatusMessage(ws, memory, 'status.transport', { speak: false });
    sendVoiceUiNavigate(ws, memory);
    return;
  }
  if (/\b(transport|courier|shipping)\b/i.test(t)) {
    sendStatusMessage(ws, memory, 'status.transport', { speak: false });
    return;
  }
  if (
    pending?.type === 'await_place_confirm' ||
    /\b(place (the )?order|confirm order)\b/i.test(t)
  ) {
    sendStatusMessage(ws, memory, 'status.order');
    return;
  }
  if (/\b(search|find|cart|add|product|mac|cement|steel)/i.test(t)) {
    sendStatusMessage(ws, memory, 'status.catalog');
  }
}

async function streamReply(ws, orchestrator, userText) {
  let fullReply = '';
  const onChunk = (chunk) => {
    fullReply += chunk;
    send(ws, { type: 'reply_chunk', text: chunk });
  };

  const langBefore = resolveVoiceLanguage(orchestrator.memory);
  const languageSelectedBefore = orchestrator.memory?.isVoiceLanguageSelected?.() ?? false;

  const reply = await orchestrator.handleTranscript(userText, { onChunk });
  const finalText = reply || fullReply;

  const langAfter = resolveVoiceLanguage(orchestrator.memory);
  const languageSelectedAfter = orchestrator.memory?.isVoiceLanguageSelected?.() ?? false;
  const fastTts =
    (!languageSelectedBefore && languageSelectedAfter) || langBefore !== langAfter;

  const navigateOrders =
    Boolean(orchestrator.memory?.getJson?.('voice_navigate_orders', false)) ||
    /order is placed|order placed|ऑर्डर|ఆర్డర్|ಆರ್ಡರ್/i.test(finalText);
  if (navigateOrders) {
    orchestrator.memory?.setJson?.('voice_navigate_orders', false);
    send(ws, {
      type: 'ui_navigate',
      path: '/your-orders',
      label: voiceText(orchestrator.memory, 'nav.ordersScreenLabel'),
      screen: 'orders'
    });
  } else if (!fastTts) {
    sendVoiceUiNavigate(ws, orchestrator.memory, {
      replyText: finalText,
      instant: false
    });
  }

  if (fastTts) {
    send(ws, { type: 'language_set', language: langAfter, selected: true });
    send(ws, { type: 'reply_done', text: finalText, instant: true });
    if (voiceTtsService.isEnabled() && finalText) {
      await streamReplyTts(ws, finalText, langAfter, { fast: true });
    }
    return {
      finalText,
      instant: true,
      languageChanged: true
    };
  }

  send(ws, { type: 'reply_done', text: finalText, instant: false });

  if (voiceTtsService.isEnabled() && finalText) {
    await streamReplyTts(ws, finalText, langAfter, { fast: false });
  }

  return {
    finalText,
    instant: fastTts,
    languageChanged: fastTts
  };
}

/** Server TTS — queued per socket so lines never talk over each other. */
function streamReplyTts(ws, finalText, languageId, { fast = false, statusLine = false } = {}) {
  const line = String(finalText || '').trim();
  if (!line || !voiceTtsService.isEnabled()) return;

  return enqueueWsTts(ws, async () => {
    const st = voiceConn(ws);
    const seq = (st.ttsSeq += 1);
    if (!statusLine) {
      send(ws, { type: 'agent_state', state: 'speaking' });
    }
    send(ws, { type: 'tts_start', seq, statusLine: Boolean(statusLine) });

    try {
      const ttsResult = await voiceTtsService.streamSpeak(
        line,
        languageId,
        (payload) => {
          send(ws, {
            type: 'tts_chunk',
            seq,
            chunk: payload.chunk,
            encoding: payload.encoding || 'pcm16',
            sampleRate: payload.sampleRate || 24000,
            phraseIndex: payload.phraseIndex ?? 0,
            phraseCount: payload.phraseCount ?? 1,
            lastInPhrase: payload.lastInPhrase !== false
          });
        },
        { fast }
      );
      if (ttsResult?.ok) {
        send(ws, {
          type: 'tts_done',
          seq,
          provider: ttsResult.provider || voiceTtsService.providerLabel()
        });
      } else {
        send(ws, { type: 'tts_skipped', seq, reason: 'unavailable' });
      }
    } catch (err) {
      logger.warn('[voice] TTS skipped:', err.message);
      send(ws, { type: 'tts_skipped', seq, reason: err.message || 'error' });
    }
  });
}

export function attachVoiceWebSocket(server) {
  ragService.warm();
  edgeTtsService.warm();

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
    memory.setVoiceLanguage(resolveDefaultVoiceLanguage());
    memory.setVoiceLanguageSelected(false);
    let orchestrator = null;
    let busy = false;
    audioBuffers.set(ws, []);

    send(ws, {
      type: 'ready',
      sessionId,
      language: resolveVoiceLanguage(memory),
      pipeline: {
        whisper: whisperService.isEnabled(),
        serverTts: voiceTtsService.isEnabled(),
        ttsProvider: voiceTtsService.providerLabel(),
        piper: voiceTtsService.isEnabled(),
        streaming: true
      }
    });

    ws.on('message', (raw) => {
      void (async () => {
        if (busy) {
          send(ws, { type: 'error', code: 'busy', message: voiceText(memory, 'ws.busy') });
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
            send(ws, { type: 'error', code: 'auth_failed', message: voiceText(memory, 'ws.authFailed') });
            return;
          }
          orchestrator = new AiOrchestrator(data.token, memory);
          attachVoiceStatusEmitter(ws, memory, orchestrator.toolCtx);
          orchestrator.toolCtx.onCartUpdated = () => {
            send(ws, { type: 'cart_updated' });
          };
          send(ws, { type: 'auth_ok', sessionId });
          send(ws, { type: 'agent_state', state: 'listening' });
          return;
        }

        if (type === 'transport_selected' && orchestrator) {
          busy = true;
          try {
            const { applyUiTransportSelection } = await import('./checkout/checkout_flow_transport.js');
            const speech = await applyUiTransportSelection(
              orchestrator.toolCtx,
              memory,
              data.selection || data
            );
            if (speech) {
              send(ws, { type: 'agent_reply', text: speech });
              sendVoiceUiNavigate(ws, memory, { replyText: speech });
            }
            send(ws, { type: 'cart_updated' });
            send(ws, { type: 'agent_state', state: 'listening' });
          } catch (err) {
            logger.error('[voice] transport_selected:', err);
            send(ws, {
              type: 'error',
              code: 'transport_sync_failed',
              message: voiceText(memory, 'error.pipeline')
            });
          } finally {
            busy = false;
          }
          return;
        }

        if (type === 'call_start' && orchestrator) {
          const flow = String(data.flow || '').toLowerCase();
          const requestedLanguage = normalizeVoiceLanguage(data.language);
          if (requestedLanguage) {
            memory.setVoiceLanguage(requestedLanguage);
            memory.setVoiceLanguageSelected(true);
            logger.info(`[voice] language selected at call_start: ${requestedLanguage}`);
          }
          send(ws, {
            type: 'language_set',
            language: resolveVoiceLanguage(memory),
            selected: memory.isVoiceLanguageSelected()
          });
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

        if (type === 'tts_speak') {
          const line = String(data.text || '').trim();
          if (!line) return;
          const lang = resolveVoiceLanguage(memory);
          send(ws, { type: 'reply_done', text: line, instant: true });
          if (voiceTtsService.isEnabled()) {
            void streamReplyTts(ws, line, lang, { fast: true });
          }
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
            const beforeLanguage = resolveVoiceLanguage(memory);
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
              send(ws, { type: 'agent_reply', text: voiceText(memory, 'error.noAudio') });
              send(ws, { type: 'agent_state', state: 'listening' });
              return;
            }

            const prepared = prepareUserTranscript(memory, userText);
            userText = prepared.text;
            if (prepared.noise || !userText) {
              send(ws, { type: 'stt_final', text: '' });
              send(ws, { type: 'agent_reply', text: prepared.reply || voiceText(memory, 'stt.didNotCatch') });
              send(ws, { type: 'agent_state', state: 'listening' });
              return;
            }

            send(ws, { type: 'stt_final', text: userText });
            send(ws, { type: 'final_transcript', text: userText });
            const langPick = isLanguagePickUtterance(memory, userText);
            if (!langPick) sendStatusForUtterance(ws, userText, memory);
            send(ws, { type: 'agent_state', state: langPick ? 'speaking' : 'thinking' });
            if (!langPick) armPoliteWait(ws, memory, () => busy);

            const result = await withVoiceLanguage(resolveVoiceLanguage(memory), () =>
              streamReply(ws, orchestrator, userText)
            );
            const afterLanguage = resolveVoiceLanguage(memory);
            if (!result.languageChanged && beforeLanguage !== afterLanguage) {
              logger.info(`[voice] language switched: ${beforeLanguage} -> ${afterLanguage}`);
              send(ws, { type: 'language_set', language: afterLanguage, selected: true });
            }
            send(ws, {
              type: 'agent_reply',
              text: result.finalText,
              instant: Boolean(result.instant)
            });
            send(ws, { type: 'call_active', inCall: true });

            if (process.env.VOICE_DEBUG === 'true') {
              logger.info(`[voice] total ${Date.now() - t0}ms instant=${result.instant}`);
            }
            if (!result.instant) {
              send(ws, { type: 'agent_state', state: 'listening' });
            }
          } catch (err) {
            logger.error('[voice] pipeline:', err);
            const safeMsg = safePipelineUserMessage(memory);
            send(ws, { type: 'error', code: 'pipeline_error', message: safeMsg });
            send(ws, { type: 'agent_reply', text: safeMsg });
            send(ws, { type: 'agent_state', state: 'listening' });
          } finally {
            clearPoliteWaitTimer(ws);
            busy = false;
          }
          return;
        }

        if (type === 'text') {
          const rawText = String(data.text || '').trim();
          if (!rawText) return;

          busy = true;
          const t0 = Date.now();
          try {
            const beforeLanguage = resolveVoiceLanguage(memory);
            const prepared = prepareUserTranscript(memory, rawText);
            const userText = prepared.text;
            if (prepared.noise || !userText) {
              send(ws, { type: 'stt_final', text: '' });
              send(ws, { type: 'agent_reply', text: prepared.reply || voiceText(memory, 'stt.didNotCatch') });
              send(ws, { type: 'agent_state', state: 'listening' });
              return;
            }

            send(ws, { type: 'stt_final', text: userText });
            send(ws, { type: 'final_transcript', text: userText });
            const langPick = isLanguagePickUtterance(memory, userText);
            if (!langPick) sendStatusForUtterance(ws, userText, memory);
            send(ws, { type: 'agent_state', state: langPick ? 'speaking' : 'thinking' });
            if (!langPick) armPoliteWait(ws, memory, () => busy);

            const result = await withVoiceLanguage(resolveVoiceLanguage(memory), () =>
              streamReply(ws, orchestrator, userText)
            );
            const afterLanguage = resolveVoiceLanguage(memory);
            if (!result.languageChanged && beforeLanguage !== afterLanguage) {
              logger.info(`[voice] language switched: ${beforeLanguage} -> ${afterLanguage}`);
              send(ws, { type: 'language_set', language: afterLanguage, selected: true });
            }
            send(ws, {
              type: 'agent_reply',
              text: result.finalText,
              instant: Boolean(result.instant)
            });
            send(ws, { type: 'call_active', inCall: true });

            if (process.env.VOICE_DEBUG === 'true') {
              logger.info(`[voice] text ${Date.now() - t0}ms instant=${result.instant}`);
            }
            if (!result.instant) {
              send(ws, { type: 'agent_state', state: 'listening' });
            }
          } catch (err) {
            logger.error('[voice] text:', err);
            const safeMsg = safePipelineUserMessage(memory);
            send(ws, { type: 'error', code: 'pipeline_error', message: safeMsg });
            send(ws, { type: 'agent_reply', text: safeMsg });
            send(ws, { type: 'agent_state', state: 'listening' });
          } finally {
            clearPoliteWaitTimer(ws);
            busy = false;
          }
          return;
        }

        send(ws, { type: 'error', code: 'unknown_message_type' });
      })();
    });

    ws.on('close', () => {
      clearPoliteWaitTimer(ws);
      wsVoiceState.delete(ws);
      audioBuffers.delete(ws);
    });
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
