import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createCallSpeechRecognizer,
  speakVoiceReply,
  speakStatus,
  stopSpeaking,
  unlockSpeech,
  preloadVoices
} from './browserSpeech.js';
import { isEndCallPhrase, isSendTurnPhrase, stripSendPhrase } from './callPhrases.js';
import { playPcmChunk, resetAudioPlayback, resumeAudioPlayback } from './audioPlayback.js';
import { createVoiceSocket } from './voiceSocket.js';
import { VOICE_AGENT_GREETING } from './voiceGreeting.js';
import { setVoiceGuidedActive } from './voiceCartBridge.js';
import { voiceStartRouteForPathname } from './voiceStartRoutes.js';

/** Long checkout steps (transport quotes) can take 1–2 minutes. */
const REPLY_TIMEOUT_MS = 180000;
const RESUME_MIC_MS = 600;
const REPLY_DONE_RESUME_MS = 1200;
const MAX_SPEAK_MS = 120000;
/** Auto-send after user stops speaking (real-call feel). */
const AUTO_SEND_PAUSE_MS = 1400;
const MIN_AUTO_SEND_CHARS = 2;
/** Only skip browser TTS when server Piper is explicitly enabled on the client. */
const USE_SERVER_TTS_ONLY = import.meta.env.VITE_VOICE_SERVER_TTS === 'true';

export function useVoiceSession(token, { onNavigate } = {}) {
  const debug = typeof localStorage !== 'undefined' && localStorage.getItem('VOICE_DEBUG') === '1';

  const [state, setState] = useState('connecting');
  const [error, setError] = useState('');
  const [voiceScreen, setVoiceScreen] = useState('');
  const [voicePath, setVoicePath] = useState('');
  const [inCall, setInCall] = useState(false);
  const [lastReply, setLastReply] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const [interimText, setInterimText] = useState('');
  const [connected, setConnected] = useState(false);

  const socketRef = useRef(null);
  const recognizerRef = useRef(null);
  const replyTimerRef = useRef(null);
  const resumeTimerRef = useRef(null);
  const sentRef = useRef(false);
  const streamBufRef = useRef('');
  const serverPiperEnabledRef = useRef(false);
  const serverTtsChunksRef = useRef(0);
  const inCallRef = useRef(false);
  const connectedRef = useRef(false);
  const processingRef = useRef(false);
  const micPausedRef = useRef(false);
  const unmountedRef = useRef(false);
  const pendingTextRef = useRef('');
  const autoSendTimerRef = useRef(null);
  const replyDoneTimerRef = useRef(null);
  const speakSafetyTimerRef = useRef(null);

  const log = useCallback(
    (...args) => {
      if (debug) console.log('[voice]', ...args);
    },
    [debug]
  );

  const setUiState = (s) => {
    if (inCallRef.current && s === 'ready') {
      setState('listening');
      return;
    }
    setState(s);
  };

  const clearReplyTimer = () => {
    if (replyTimerRef.current) {
      clearTimeout(replyTimerRef.current);
      replyTimerRef.current = null;
    }
  };

  const clearResumeTimer = () => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  };

  const clearAutoSendTimer = () => {
    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }
  };

  const clearReplyDoneTimer = () => {
    if (replyDoneTimerRef.current) {
      clearTimeout(replyDoneTimerRef.current);
      replyDoneTimerRef.current = null;
    }
  };

  const clearSpeakSafetyTimer = () => {
    if (speakSafetyTimerRef.current) {
      clearTimeout(speakSafetyTimerRef.current);
      speakSafetyTimerRef.current = null;
    }
  };

  const bumpReplyTimer = useCallback(() => {
    if (!sentRef.current) return;
    clearReplyTimer();
    replyTimerRef.current = setTimeout(() => {
      processingRef.current = false;
      sentRef.current = false;
      micPausedRef.current = false;
      if (inCallRef.current) {
        setError('Still working… you can speak again, or wait a moment and repeat.');
        resumeMicRef.current();
      }
    }, REPLY_TIMEOUT_MS);
  }, []);

  const endCallFromVoiceRef = useRef(() => {});

  const scheduleAutoSend = useCallback((text) => {
    clearAutoSendTimer();
    const clean = String(text || '').trim();
    if (!inCallRef.current || processingRef.current || sentRef.current) return;
    if (isEndCallPhrase(clean)) {
      endCallFromVoiceRef.current();
      return;
    }
    if (clean.length < MIN_AUTO_SEND_CHARS) return;

    autoSendTimerRef.current = setTimeout(() => {
      autoSendTimerRef.current = null;
      if (!inCallRef.current || processingRef.current || sentRef.current) return;
      const latest =
        recognizerRef.current?.getTranscript?.() || pendingTextRef.current || clean;
      if (String(latest).trim().length < MIN_AUTO_SEND_CHARS) return;
      log('auto-send after pause', latest);
      try {
        recognizerRef.current?.abort?.();
      } catch {
        /* ignore */
      }
      recognizerRef.current = null;
      sendTurnRef.current(latest);
    }, AUTO_SEND_PAUSE_MS);
  }, [log]);

  const pauseMicCapture = () => {
    micPausedRef.current = true;
    try {
      recognizerRef.current?.abort();
    } catch {
      /* ignore */
    }
    recognizerRef.current = null;
  };

  const endCall = useCallback(() => {
    log('call ended by user');
    setVoiceGuidedActive(false);
    inCallRef.current = false;
    processingRef.current = false;
    micPausedRef.current = false;
    setInCall(false);
    clearResumeTimer();
    clearAutoSendTimer();
    clearReplyDoneTimer();
    clearSpeakSafetyTimer();
    pauseMicCapture();
    setInterimText('');
    pendingTextRef.current = '';
    setVoiceScreen('');
    stopSpeaking();
    sentRef.current = false;
    setUiState(connectedRef.current ? 'ready' : 'disconnected');
  }, [log]);

  const shouldSkipBrowserTts = () =>
    USE_SERVER_TTS_ONLY &&
    serverPiperEnabledRef.current &&
    serverTtsChunksRef.current > 0;

  const speak = (text, { onEnd, force = false } = {}) => {
    clearSpeakSafetyTimer();
    const toSpeak = String(text || '').trim();
    if (!toSpeak) {
      onEnd?.();
      return;
    }
    if (!force && shouldSkipBrowserTts()) {
      onEnd?.();
      return;
    }
    stopSpeaking();
    const finish = () => {
      clearSpeakSafetyTimer();
      onEnd?.();
    };
    speakSafetyTimerRef.current = setTimeout(finish, MAX_SPEAK_MS);
    requestAnimationFrame(() => {
      const started = speakVoiceReply(toSpeak, {
        onStart: () => {
          if (inCallRef.current) setUiState('speaking');
        },
        onEnd: finish
      });
      if (!started) finish();
    });
  };

  const endCallFromVoice = useCallback(() => {
    if (!inCallRef.current) return;
    clearAutoSendTimer();
    pauseMicCapture();
    speak('Goodbye. Ending the call.', { onEnd: endCall });
  }, [endCall]);

  endCallFromVoiceRef.current = endCallFromVoice;

  const beginCallListening = useCallback(() => {
    if (!inCallRef.current || !connectedRef.current || unmountedRef.current) return;
    if (processingRef.current || sentRef.current || micPausedRef.current) return;
    if (recognizerRef.current) return;

    setInCall(true);
    inCallRef.current = true;
    setError('');

    const rec = createCallSpeechRecognizer({
      onInterim: (text) => {
        if (!inCallRef.current || micPausedRef.current) return;
        clearAutoSendTimer();
        pendingTextRef.current = text;
        setInterimText(text);
        setUiState('listening');
      },
      onFinal: (text) => {
        if (!inCallRef.current || micPausedRef.current) return;
        pendingTextRef.current = text;
        setInterimText(text);
        if (isEndCallPhrase(String(text || '').trim())) {
          endCallFromVoiceRef.current();
          return;
        }
        scheduleAutoSend(text);
      },
      onError: (e) => {
        if (!inCallRef.current || micPausedRef.current) return;
        if (e.error === 'not-allowed') {
          setError('Microphone permission denied');
          endCall();
          return;
        }
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        clearResumeTimer();
        resumeTimerRef.current = setTimeout(() => {
          resumeTimerRef.current = null;
          if (inCallRef.current && !micPausedRef.current) beginCallListening();
        }, RESUME_MIC_MS);
      },
      shouldKeepListening: () =>
        inCallRef.current && !micPausedRef.current && !processingRef.current && !sentRef.current
    });

    if (!rec.isSupported) {
      setError('Use Chrome or Edge for voice.');
      endCall();
      return;
    }

    recognizerRef.current = rec;
    rec.start();
    setUiState('listening');
    log('listening');
  }, [endCall, log, scheduleAutoSend]);

  const resumeMicAfterReply = useCallback(() => {
    if (!inCallRef.current) return;
    clearResumeTimer();
    processingRef.current = false;
    sentRef.current = false;
    micPausedRef.current = false;
    setInCall(true);
    inCallRef.current = true;
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null;
      if (inCallRef.current) beginCallListening();
    }, RESUME_MIC_MS);
  }, [beginCallListening]);

  const sendTurn = useCallback(
    (rawText) => {
      if (!inCallRef.current) return;

      let clean = String(rawText || '').trim();

      if (isEndCallPhrase(clean)) {
        endCallFromVoice();
        return;
      }

      if (isSendTurnPhrase(clean)) {
        clean = stripSendPhrase(clean);
      }

      if (!clean) {
        beginCallListening();
        return;
      }

      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        setError('Connection lost. Say end the call, then tap Start speaking again.');
        return;
      }
      if (sentRef.current) return;

      clearAutoSendTimer();
      processingRef.current = true;
      sentRef.current = true;
      micPausedRef.current = true;
      pauseMicCapture();
      setInterimText('');
      pendingTextRef.current = '';
      setStreamingReply('');
      streamBufRef.current = '';
      setUiState('thinking');
      log('send', clean);

      if (!socketRef.current.sendText(clean)) {
        processingRef.current = false;
        sentRef.current = false;
        micPausedRef.current = false;
        setError('Could not send. Say end call or tap End call.');
        resumeMicAfterReply();
        return;
      }

      bumpReplyTimer();
    },
    [log, endCall, endCallFromVoice, speak, resumeMicAfterReply, beginCallListening, bumpReplyTimer]
  );

  const resumeMicRef = useRef(resumeMicAfterReply);
  const sendTurnRef = useRef(sendTurn);
  const connectSocketRef = useRef(null);
  const beginCallListeningRef = useRef(beginCallListening);
  const onNavigateRef = useRef(onNavigate);
  resumeMicRef.current = resumeMicAfterReply;
  sendTurnRef.current = sendTurn;
  beginCallListeningRef.current = beginCallListening;
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    if (!token) return undefined;
    unmountedRef.current = false;

    const makeHandlers = () => ({
      onReady: (data) => {
        serverPiperEnabledRef.current = Boolean(data?.pipeline?.piper);
      },
      onAuthOk: () => {
        connectedRef.current = true;
        setConnected(true);
        setError('');
        if (inCallRef.current) {
          setInCall(true);
          inCallRef.current = true;
          if (!processingRef.current && !sentRef.current) {
            setUiState('listening');
            beginCallListeningRef.current?.();
          }
        } else {
          setUiState('ready');
        }
      },
      onUiNavigate: (data) => {
        if (!inCallRef.current) return;
        const label = data?.label || '';
        const path = data?.path || '';
        if (label) setVoiceScreen(label);
        if (path) setVoicePath(path);
        onNavigateRef.current?.(data);
      },
      onMessage: (data) => {
        if (!inCallRef.current) return;
        if (data.type === 'ui_navigate') {
          const label = data.label || '';
          const path = data.path || '';
          if (label) setVoiceScreen(label);
          if (path) setVoicePath(path);
          onNavigateRef.current?.(data);
          return;
        }
        if (data.type === 'status_message') {
          const statusText = data.text || 'Working on your request…';
          setStreamingReply(statusText);
          setUiState('thinking');
          bumpReplyTimer();
          if (!shouldSkipBrowserTts()) {
            speakStatus(statusText);
          }
        }
        if (data.type === 'call_active') {
          setInCall(true);
          inCallRef.current = true;
        }
      },
      onAgentState: (s) => {
        if (!inCallRef.current) {
          if (s === 'listening') setUiState('ready');
          else setUiState(s);
          return;
        }
        if (s === 'listening') setUiState('listening');
        else setUiState(s);
      },
      onReplyChunk: (chunk) => {
        streamBufRef.current += chunk;
        setStreamingReply(streamBufRef.current);
        bumpReplyTimer();
      },
      onReplyDone: (text) => {
        bumpReplyTimer();
        setLastReply(text || streamBufRef.current);
        setStreamingReply('');
        streamBufRef.current = '';
        clearReplyDoneTimer();
        replyDoneTimerRef.current = setTimeout(() => {
          replyDoneTimerRef.current = null;
          if (!inCallRef.current || !sentRef.current) return;
          clearReplyTimer();
          sentRef.current = false;
          processingRef.current = false;
          micPausedRef.current = false;
          setInCall(true);
          inCallRef.current = true;
          resumeMicRef.current();
        }, REPLY_DONE_RESUME_MS);
      },
      onTtsChunk: (chunk) => {
        if (!USE_SERVER_TTS_ONLY || !serverPiperEnabledRef.current) return;
        if (playPcmChunk(chunk)) serverTtsChunksRef.current += 1;
        micPausedRef.current = true;
        pauseMicCapture();
        setUiState('speaking');
      },
      onAgentReply: (text) => {
        clearReplyTimer();
        clearReplyDoneTimer();
        bumpReplyTimer();
        sentRef.current = false;
        processingRef.current = false;
        const replyText = String(text || streamBufRef.current || '').trim();
        setLastReply(replyText);
        setStreamingReply('');
        streamBufRef.current = '';
        setError('');
        setInCall(true);
        inCallRef.current = true;
        micPausedRef.current = true;
        pauseMicCapture();

        const resume = () => {
          clearReplyTimer();
          serverTtsChunksRef.current = 0;
          if (inCallRef.current) {
            setInCall(true);
            inCallRef.current = true;
            resumeMicRef.current();
          }
        };

        const usedServerOnly = shouldSkipBrowserTts();
        if (replyText && !usedServerOnly) {
          speak(replyText, { onEnd: resume });
        } else if (replyText && usedServerOnly) {
          setUiState('speaking');
          const estMs = Math.min(MAX_SPEAK_MS, Math.max(4000, replyText.length * 55));
          speakSafetyTimerRef.current = setTimeout(resume, estMs);
        } else {
          resume();
        }
      },
      onError: (err) => {
        clearReplyTimer();
        sentRef.current = false;
        processingRef.current = false;
        micPausedRef.current = false;

        if (inCallRef.current) {
          setError(err.message || 'Error — call still active. Speak again.');
          resumeMicRef.current();
          return;
        }
        if (err.code === 'connection_closed' || err.code === 'connection_failed') {
          connectedRef.current = false;
          setConnected(false);
          setState('disconnected');
        }
      },
      onClose: ({ intentional } = {}) => {
        clearReplyTimer();
        if (intentional || unmountedRef.current) return;
        if (inCallRef.current) {
          setError('Reconnecting… call still active.');
          connectSocketRef.current?.();
          return;
        }
        connectedRef.current = false;
        setConnected(false);
        setState('disconnected');
      }
    });

    const connectSocket = () => {
      if (unmountedRef.current) return;
      if (socketRef.current?.readyState === WebSocket.OPEN) return;
      socketRef.current = createVoiceSocket({ token, handlers: makeHandlers() });
    };

    connectSocketRef.current = connectSocket;
    connectSocket();

    return () => {
      unmountedRef.current = true;
      clearReplyTimer();
      clearResumeTimer();
      clearAutoSendTimer();
      clearReplyDoneTimer();
      clearSpeakSafetyTimer();
      inCallRef.current = false;
      socketRef.current?.close();
      socketRef.current = null;
      stopSpeaking();
      resetAudioPlayback();
      pauseMicCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keep socket stable during call
  }, [token]);

  const startSpeaking = useCallback(() => {
    unlockSpeech();
    void preloadVoices();
    void resumeAudioPlayback();
    serverTtsChunksRef.current = 0;
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setError('Connecting… try again in a moment.');
      connectSocketRef.current?.();
      return;
    }
    inCallRef.current = true;
    processingRef.current = false;
    sentRef.current = false;
    micPausedRef.current = false;
    setInCall(true);
    setError('');
    setLastReply(VOICE_AGENT_GREETING);
    micPausedRef.current = true;
    setUiState('speaking');
    const startRoute =
      typeof window !== 'undefined' ? voiceStartRouteForPathname(window.location.pathname) : null;
    if (startRoute) {
      setVoiceGuidedActive(true, startRoute.label);
      setVoicePath(startRoute.path);
      onNavigateRef.current?.(startRoute);
    } else {
      setVoiceGuidedActive(true, 'Voice shop');
    }

    const callFlow =
      startRoute?.screen === 'cart'
        ? 'cart'
        : startRoute?.screen === 'product_discovery'
          ? 'discovery'
          : null;

    speak(VOICE_AGENT_GREETING, {
      onEnd: () => {
        if (!inCallRef.current) return;
        if (callFlow) {
          socketRef.current?.sendCallStart?.(callFlow);
        }
        micPausedRef.current = false;
        beginCallListening();
      }
    });
  }, [beginCallListening]);

  return {
    state,
    error,
    voiceScreen,
    voicePath,
    inCall,
    connected,
    lastReply: streamingReply || lastReply,
    interimText,
    startSpeaking,
    endCall
  };
}
