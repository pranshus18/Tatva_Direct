import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createCallSpeechRecognizer,
  speakVoiceReply,
  speakStatus,
  stopSpeaking,
  unlockSpeech,
  preloadVoices,
  setSpeechLanguage
} from './browserSpeech.js';
import { resolveSpeechLocale, resolveSttLocaleForText } from './speechAccent.js';
import { isLikelySpeechNoise, normalizeVoiceUtterance } from './normalizeUtterance.js';
import { isEndCallPhrase, isSendTurnPhrase, stripSendPhrase } from './callPhrases.js';
import {
  getPlaybackRemainingSec,
  beginPlaybackUtterance,
  playAudioChunk,
  resetAudioPlayback,
  resumeAudioPlayback
} from './audioPlayback.js';
import { createVoiceSocket } from './voiceSocket.js';
import { emitVoiceCartUpdated, fetchVoiceCartDraft, setVoiceGuidedActive } from './voiceCartBridge.js';
import { voiceStartRouteForPathname } from './voiceStartRoutes.js';
import { getDefaultVoiceLanguage, getVoiceLanguageMeta, normalizeVoiceLanguage } from './voiceLanguage.js';
import { languageSelectionPrompt, voiceText } from './voiceText.js';

/** Long checkout steps (transport quotes) can take 1–2 minutes. */
const REPLY_TIMEOUT_MS = 180000;
const RESUME_MIC_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_RESUME_MIC_MS || '60'), 10) || 60;
const REPLY_DONE_RESUME_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_REPLY_DONE_RESUME_MS || '0'), 10) || 0;
const TTS_DONE_TAIL_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_TTS_DONE_TAIL_MS || '90'), 10) || 90;
const TTS_DONE_MIN_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_TTS_DONE_MIN_MS || '80'), 10) || 80;
const MAX_SPEAK_MS = 120000;
/** Browser fallback only if server TTS never starts for this reply. */
const SERVER_TTS_FALLBACK_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_SERVER_TTS_FALLBACK_MS || '8000'), 10) || 8000;
const INSTANT_TTS_FALLBACK_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_INSTANT_TTS_FALLBACK_MS || '2500'), 10) || 2500;
/** Auto-send after user stops speaking (real-call feel). */
const AUTO_SEND_PAUSE_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_AUTO_SEND_PAUSE_MS || '850'), 10) || 850;
/** Faster send when user only said a language name (English / Hindi / …). */
const LANGUAGE_PICK_SEND_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_LANGUAGE_PICK_SEND_MS || '200'), 10) || 200;
const LANGUAGE_PICK_UTTERANCE_RE =
  /^(english|hinglish|hindi|kannada|telugu|हिंदी|हिन्दी|हिंग्लिश|ಕನ್ನಡ|తెలుగు)$/i;
const LANGUAGE_PICK_TTS_TAIL_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_LANGUAGE_PICK_TTS_TAIL_MS || '25'), 10) || 25;
const LANGUAGE_PICK_TTS_MIN_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_LANGUAGE_PICK_TTS_MIN_MS || '35'), 10) || 35;
const LANGUAGE_PICK_RESUME_MIC_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_LANGUAGE_PICK_RESUME_MS || '50'), 10) || 50;
const MIN_AUTO_SEND_CHARS = 2;
/** Single-digit / number-word turns (quantity pick) must auto-send despite MIN length. */
const SHORT_QUANTITY_UTTERANCE_RE =
  /^(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|paanch|ondu|eradu|rendu|moodu|एक|दो|तीन|ಒಂದು|ಎರಡು|రెండు)$/i;
/** Default on: one server neural voice only (no browser + server mix). Set VITE_VOICE_SERVER_TTS=false to allow browser fallback. */
const FORCE_SERVER_TTS_ONLY = import.meta.env.VITE_VOICE_SERVER_TTS !== 'false';

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
  const [voiceLanguage, setVoiceLanguage] = useState(getDefaultVoiceLanguage());

  const socketRef = useRef(null);
  const recognizerRef = useRef(null);
  const replyTimerRef = useRef(null);
  const resumeTimerRef = useRef(null);
  const sentRef = useRef(false);
  const streamBufRef = useRef('');
  const serverTtsEnabledRef = useRef(false);
  const serverTtsChunksRef = useRef(0);
  const ttsSeqRef = useRef(0);
  const playbackGenRef = useRef(0);
  const serverTtsDoneRef = useRef(false);
  const instantSpeakActiveRef = useRef(false);
  const browserSpeakFallbackRef = useRef(null);
  const awaitingServerTtsRef = useRef(false);
  const pendingReplyForTtsRef = useRef('');
  const lastReplyForTtsRef = useRef('');
  const greetingPendingRef = useRef(false);
  const greetingAfterRef = useRef(null);
  const languagePickPendingRef = useRef(false);
  const statusOnlyTtsRef = useRef(false);
  const mainReplyTtsPendingRef = useRef(false);
  const usingServerAudioRef = useRef(false);
  const inCallRef = useRef(false);
  const connectedRef = useRef(false);
  const processingRef = useRef(false);
  const micPausedRef = useRef(false);
  const unmountedRef = useRef(false);
  const pendingTextRef = useRef('');
  const autoSendTimerRef = useRef(null);
  const replyDoneTimerRef = useRef(null);
  const speakSafetyTimerRef = useRef(null);
  const voiceLanguageRef = useRef(getDefaultVoiceLanguage());

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
        setError(voiceText(voiceLanguageRef.current, 'ui.stillWorking'));
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
    if (clean.length < MIN_AUTO_SEND_CHARS && !SHORT_QUANTITY_UTTERANCE_RE.test(clean)) return;

    const sendDelay = LANGUAGE_PICK_UTTERANCE_RE.test(clean) ? LANGUAGE_PICK_SEND_MS : AUTO_SEND_PAUSE_MS;

    autoSendTimerRef.current = setTimeout(() => {
      autoSendTimerRef.current = null;
      if (!inCallRef.current || processingRef.current || sentRef.current) return;
      const latest = normalizeVoiceUtterance(
        String(recognizerRef.current?.getTranscript?.() || pendingTextRef.current || clean).trim()
      );
      const latestTrim = String(latest).trim();
      if (latestTrim.length < MIN_AUTO_SEND_CHARS && !SHORT_QUANTITY_UTTERANCE_RE.test(latestTrim)) return;
      if (isLikelySpeechNoise(latestTrim)) {
        log('ignored noise on auto-send', latestTrim);
        return;
      }
      log('auto-send after pause', latestTrim);
      try {
        recognizerRef.current?.abort?.();
      } catch {
        /* ignore */
      }
      recognizerRef.current = null;
      sendTurnRef.current(latestTrim);
    }, sendDelay);
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
    clearServerTtsWait();
    pauseMicCapture();
    setInterimText('');
    pendingTextRef.current = '';
    setVoiceScreen('');
    stopSpeaking();
    sentRef.current = false;
    setUiState(connectedRef.current ? 'ready' : 'disconnected');
  }, [log]);

  /** When server TTS is on, use one voice path only (Edge neural on server). */
  const shouldSkipBrowserTts = () => {
    if (!serverTtsEnabledRef.current) return false;
    if (FORCE_SERVER_TTS_ONLY) return true;
    return (
      awaitingServerTtsRef.current ||
      usingServerAudioRef.current ||
      serverTtsChunksRef.current > 0 ||
      serverTtsDoneRef.current
    );
  };

  const armServerTtsFallback = (replyText, onEnd, { delayMs = SERVER_TTS_FALLBACK_MS } = {}) => {
    clearBrowserSpeakFallback();
    if (!serverTtsEnabledRef.current || !replyText) return;
    pendingReplyForTtsRef.current = replyText;
    lastReplyForTtsRef.current = replyText;
    awaitingServerTtsRef.current = true;
    browserSpeakFallbackRef.current = setTimeout(() => {
      browserSpeakFallbackRef.current = null;
      if (!awaitingServerTtsRef.current) return;
      awaitingServerTtsRef.current = false;
      pendingReplyForTtsRef.current = '';
      speak(replyText, { onEnd, force: true });
    }, delayMs);
  };

  const clearServerTtsWait = () => {
    awaitingServerTtsRef.current = false;
    pendingReplyForTtsRef.current = '';
    clearBrowserSpeakFallback();
  };

  const clearBrowserSpeakFallback = () => {
    if (browserSpeakFallbackRef.current) {
      clearTimeout(browserSpeakFallbackRef.current);
      browserSpeakFallbackRef.current = null;
    }
  };

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
    if (usingServerAudioRef.current && !force) {
      onEnd?.();
      return;
    }
    const langId = voiceLanguageRef.current;
    const ttsLocale = resolveSpeechLocale(langId, toSpeak);
    stopSpeaking();
    const finish = () => {
      clearSpeakSafetyTimer();
      onEnd?.();
    };
    speakSafetyTimerRef.current = setTimeout(finish, MAX_SPEAK_MS);
    requestAnimationFrame(() => {
      const started = speakVoiceReply(toSpeak, {
        locale: ttsLocale,
        languageId: langId,
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
    speak(voiceText(voiceLanguageRef.current, 'call.ending'), { onEnd: endCall });
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
        if (isEndCallPhrase(String(text || '').trim())) {
          endCallFromVoiceRef.current();
          return;
        }
        const sttLoc = resolveSttLocaleForText(voiceLanguageRef.current, text);
        recognizerRef.current?.setLocale?.(sttLoc);
        clearAutoSendTimer();
        pendingTextRef.current = text;
        setInterimText(text);
        setUiState('listening');
      },
      onFinal: (text) => {
        if (!inCallRef.current || micPausedRef.current) return;
        recognizerRef.current?.setLocale?.(resolveSttLocaleForText(voiceLanguageRef.current, text));
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
          setError(voiceText(voiceLanguageRef.current, 'ui.micDenied'));
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
        inCallRef.current && !micPausedRef.current && !processingRef.current && !sentRef.current,
      locale: resolveSttLocaleForText(voiceLanguageRef.current, '')
    });

    if (!rec.isSupported) {
      setError(voiceText(voiceLanguageRef.current, 'ui.browserUnsupported'));
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
    const resumeMs = languagePickPendingRef.current ? LANGUAGE_PICK_RESUME_MIC_MS : RESUME_MIC_MS;
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null;
      languagePickPendingRef.current = false;
      if (inCallRef.current) beginCallListening();
    }, resumeMs);
  }, [beginCallListening]);

  const sendTurn = useCallback(
    (rawText) => {
      if (!inCallRef.current) return;

      let clean = normalizeVoiceUtterance(String(rawText || '').trim());

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

      if (isLikelySpeechNoise(clean)) {
        log('ignored noise utterance', clean);
        processingRef.current = false;
        sentRef.current = false;
        micPausedRef.current = false;
        setInterimText('');
        pendingTextRef.current = '';
        const retryMsg = voiceText(voiceLanguageRef.current, 'stt.didNotCatch', {}, '');
        if (retryMsg) speakStatus(retryMsg, null, voiceLanguageRef.current);
        beginCallListening();
        return;
      }

      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        setError(voiceText(voiceLanguageRef.current, 'ui.connectionLost'));
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
      clearServerTtsWait();
      stopSpeaking();
      serverTtsChunksRef.current = 0;
      serverTtsDoneRef.current = false;
      usingServerAudioRef.current = false;
      instantSpeakActiveRef.current = false;
      setUiState('thinking');
      log('send', clean);

      if (!socketRef.current.sendText(clean)) {
        processingRef.current = false;
        sentRef.current = false;
        micPausedRef.current = false;
        setError(voiceText(voiceLanguageRef.current, 'ui.sendFailed'));
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
        serverTtsEnabledRef.current = Boolean(
          data?.pipeline?.serverTts ?? data?.pipeline?.piper
        );
        if (data?.language) {
          const normalized = normalizeVoiceLanguage(data.language);
          if (normalized) {
            voiceLanguageRef.current = normalized;
            setVoiceLanguage(normalized);
            setSpeechLanguage(normalized);
          }
        }
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
        if (data.type === 'cart_updated') {
          void fetchVoiceCartDraft().then((draft) => emitVoiceCartUpdated(draft));
          return;
        }
        if (data.type === 'status_message') {
          const lang = voiceLanguageRef.current;
          const statusText =
            data.text ||
            voiceText(lang, 'status.pleaseWait', {}, '') ||
            voiceText(lang, 'ui.transportLoading', {}, 'One moment…');
          setStreamingReply(statusText);
          setUiState('thinking');
          bumpReplyTimer();
          statusOnlyTtsRef.current = Boolean(data.speak);
          if (serverTtsEnabledRef.current && data.speak) {
            awaitingServerTtsRef.current = true;
          } else if (
            !serverTtsEnabledRef.current &&
            !shouldSkipBrowserTts() &&
            !usingServerAudioRef.current
          ) {
            speakStatus(statusText, null, voiceLanguageRef.current);
          }
        }
        if (data.type === 'call_active') {
          setInCall(true);
          inCallRef.current = true;
        }
        if (data.type === 'language_set') {
          const normalized = normalizeVoiceLanguage(data.language);
          if (normalized) {
            voiceLanguageRef.current = normalized;
            setVoiceLanguage(normalized);
            setSpeechLanguage(normalized);
            if (!languagePickPendingRef.current) {
              void preloadVoices(resolveSpeechLocale(normalized));
            }
            pauseMicCapture();
            if (recognizerRef.current) {
              try {
                recognizerRef.current.stop();
              } catch {
                /* ignore */
              }
              recognizerRef.current = null;
            }
          }
        }
        if (data.type === 'error' && data.message) {
          setError(String(data.message));
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
      onReplyDone: (text, meta) => {
        bumpReplyTimer();
        const replyText = String(text || streamBufRef.current || '').trim();
        setLastReply(replyText);
        lastReplyForTtsRef.current = replyText;
        setStreamingReply('');
        streamBufRef.current = '';
        clearReplyDoneTimer();

        if (serverTtsEnabledRef.current && replyText && !meta?.instant) {
          mainReplyTtsPendingRef.current = true;
        }

        if (meta?.instant && replyText) {
          sentRef.current = false;
          processingRef.current = false;
          lastReplyForTtsRef.current = replyText;
          instantSpeakActiveRef.current = true;
          languagePickPendingRef.current = true;
          if (serverTtsEnabledRef.current) {
            setUiState('speaking');
            armServerTtsFallback(
              replyText,
              () => {
                instantSpeakActiveRef.current = false;
                languagePickPendingRef.current = false;
                void preloadVoices(resolveSpeechLocale(voiceLanguageRef.current));
                if (inCallRef.current) resumeMicRef.current();
              },
              { delayMs: INSTANT_TTS_FALLBACK_MS }
            );
          } else {
            clearServerTtsWait();
            setUiState('speaking');
            speak(replyText, {
              force: true,
              onEnd: () => {
                instantSpeakActiveRef.current = false;
                if (inCallRef.current) resumeMicRef.current();
              }
            });
          }
          return;
        }

        if (serverTtsEnabledRef.current) return;

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
      onTtsStart: (payload) => {
        if (!serverTtsEnabledRef.current) return;
        const seq = Number(payload?.seq) || 0;
        ttsSeqRef.current = seq;
        playbackGenRef.current = beginPlaybackUtterance();
        clearServerTtsWait();
        stopSpeaking();
        serverTtsChunksRef.current = 0;
        serverTtsDoneRef.current = false;
        usingServerAudioRef.current = false;
        statusOnlyTtsRef.current = Boolean(payload?.statusLine);
        mainReplyTtsPendingRef.current = !payload?.statusLine;
        micPausedRef.current = true;
        pauseMicCapture();
        setUiState('speaking');
      },
      onTtsChunk: (payload) => {
        if (!serverTtsEnabledRef.current || !payload?.chunk) return;
        if (payload?.seq != null && payload.seq !== ttsSeqRef.current) return;
        clearServerTtsWait();
        instantSpeakActiveRef.current = false;
        usingServerAudioRef.current = true;
        if (
          playAudioChunk(payload.chunk, {
            encoding: payload.encoding || 'pcm16',
            sampleRate: payload.sampleRate || 24000,
            generation: playbackGenRef.current
          })
        ) {
          serverTtsChunksRef.current += 1;
        }
        micPausedRef.current = true;
        pauseMicCapture();
        setUiState('speaking');
      },
      onTtsDone: (payload) => {
        if (payload?.seq != null && payload.seq !== ttsSeqRef.current) return;
        clearServerTtsWait();
        serverTtsDoneRef.current = true;
        if (!inCallRef.current || serverTtsChunksRef.current === 0) {
          usingServerAudioRef.current = false;
          if (instantSpeakActiveRef.current) {
            instantSpeakActiveRef.current = false;
            resumeMicRef.current();
          }
          return;
        }
        clearSpeakSafetyTimer();
        const tailMs = languagePickPendingRef.current ? LANGUAGE_PICK_TTS_TAIL_MS : TTS_DONE_TAIL_MS;
        const minMs = languagePickPendingRef.current ? LANGUAGE_PICK_TTS_MIN_MS : TTS_DONE_MIN_MS;
        const ms = Math.min(
          MAX_SPEAK_MS,
          Math.max(minMs, getPlaybackRemainingSec() * 1000 + tailMs)
        );
        speakSafetyTimerRef.current = setTimeout(() => {
          speakSafetyTimerRef.current = null;
          serverTtsChunksRef.current = 0;
          serverTtsDoneRef.current = false;
          usingServerAudioRef.current = false;
          mainReplyTtsPendingRef.current = false;
          statusOnlyTtsRef.current = false;
          if (languagePickPendingRef.current) {
            languagePickPendingRef.current = false;
            void preloadVoices(resolveSpeechLocale(voiceLanguageRef.current));
          }
          if (greetingPendingRef.current) {
            greetingPendingRef.current = false;
            if (inCallRef.current) {
              const callFlow =
                typeof window !== 'undefined'
                  ? voiceStartRouteForPathname(window.location.pathname)?.screen === 'cart'
                    ? 'cart'
                    : voiceStartRouteForPathname(window.location.pathname)?.screen ===
                        'product_discovery'
                      ? 'discovery'
                      : null
                  : null;
              if (callFlow) socketRef.current?.sendCallStart?.(callFlow, '');
              micPausedRef.current = false;
              beginCallListeningRef.current?.();
            }
            return;
          }
          if (inCallRef.current) resumeMicRef.current();
        }, ms);
      },
      onTtsSkipped: () => {
        const replyText = String(
          pendingReplyForTtsRef.current || lastReplyForTtsRef.current || ''
        ).trim();
        clearServerTtsWait();
        if (!inCallRef.current) return;
        instantSpeakActiveRef.current = false;
        languagePickPendingRef.current = false;
        serverTtsChunksRef.current = 0;
        serverTtsDoneRef.current = false;
        usingServerAudioRef.current = false;
        if (!replyText) {
          resumeMicRef.current();
          return;
        }
        setUiState('speaking');
        speak(replyText, {
          force: true,
          onEnd: () => {
            clearSpeakSafetyTimer();
            void preloadVoices(resolveSpeechLocale(voiceLanguageRef.current));
            if (inCallRef.current) resumeMicRef.current();
          }
        });
      },
      onAgentReply: (text, meta) => {
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
          clearSpeakSafetyTimer();
          clearServerTtsWait();
          serverTtsChunksRef.current = 0;
          serverTtsDoneRef.current = false;
          instantSpeakActiveRef.current = false;
          usingServerAudioRef.current = false;
          if (inCallRef.current) {
            setInCall(true);
            inCallRef.current = true;
            resumeMicRef.current();
          }
        };

        if (!replyText) {
          resume();
          return;
        }

        if (meta?.instant || instantSpeakActiveRef.current) {
          return;
        }

        if (serverTtsEnabledRef.current) {
          setUiState('speaking');
          if (serverTtsChunksRef.current > 0 || usingServerAudioRef.current) {
            if (!serverTtsDoneRef.current) return;
            const ms = Math.min(
              MAX_SPEAK_MS,
              Math.max(TTS_DONE_MIN_MS, getPlaybackRemainingSec() * 1000 + TTS_DONE_TAIL_MS)
            );
            speakSafetyTimerRef.current = setTimeout(resume, ms);
            return;
          }
          armServerTtsFallback(replyText, resume);
          return;
        }

        speak(replyText, { onEnd: resume });
      },
      onError: (err) => {
        clearReplyTimer();
        sentRef.current = false;
        processingRef.current = false;
        micPausedRef.current = false;

        if (inCallRef.current) {
          setError(voiceText(voiceLanguageRef.current, 'ui.genericError'));
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
          setError(voiceText(voiceLanguageRef.current, 'ui.reconnecting'));
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
    const langId = voiceLanguageRef.current;
    const ttsLoc = resolveSpeechLocale(langId);
    setSpeechLanguage(langId);
    unlockSpeech(ttsLoc);
    void preloadVoices(ttsLoc);
    void resumeAudioPlayback();
    serverTtsChunksRef.current = 0;
    serverTtsDoneRef.current = false;
    usingServerAudioRef.current = false;
    instantSpeakActiveRef.current = false;
    clearServerTtsWait();
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setError(voiceText(voiceLanguageRef.current, 'ui.connectingRetry'));
      connectSocketRef.current?.();
      return;
    }
    inCallRef.current = true;
    processingRef.current = false;
    sentRef.current = false;
    micPausedRef.current = false;
    setInCall(true);
    setError('');
    const greeting = languageSelectionPrompt();
    setLastReply(greeting);
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

    const afterGreeting = () => {
      if (!inCallRef.current) return;
      if (callFlow) {
        socketRef.current?.sendCallStart?.(callFlow, '');
      }
      micPausedRef.current = false;
      beginCallListening();
    };
    greetingAfterRef.current = afterGreeting;

    if (serverTtsEnabledRef.current || FORCE_SERVER_TTS_ONLY) {
      awaitingServerTtsRef.current = true;
      greetingPendingRef.current = true;
      socketRef.current?.sendTtsSpeak?.(greeting);
      speakSafetyTimerRef.current = setTimeout(() => {
        speakSafetyTimerRef.current = null;
        greetingPendingRef.current = false;
        afterGreeting();
      }, 12000);
    } else {
      speak(greeting, { onEnd: afterGreeting });
    }
  }, [beginCallListening]);

  const notifyTransportSelected = useCallback((selection) => {
    if (!selection || typeof selection !== 'object') return false;
    return Boolean(socketRef.current?.sendTransportSelected?.(selection));
  }, []);

  return {
    state,
    error,
    voiceScreen,
    voicePath,
    inCall,
    connected,
    voiceLanguage,
    lastReply: streamingReply || lastReply,
    interimText,
    startSpeaking,
    endCall,
    notifyTransportSelected
  };
}
