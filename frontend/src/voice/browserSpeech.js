export function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function speechSnippet(text, maxLen = 220) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const dot = cut.lastIndexOf('.');
  return dot > 60 ? cut.slice(0, dot + 1) : `${cut.trim()}…`;
}

/** Voice shopping replies — allow longer spoken answers (suppliers, transport, summary). */
const VOICE_REPLY_MAX = 520;

export function speakText(text, { onStart, onEnd, maxLen = 220 } = {}) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(speechSnippet(text, maxLen));
  utter.rate = 1.2;
  utter.pitch = 1;
  utter.lang = 'en-IN';
  if (onStart) utter.onstart = onStart;
  if (onEnd) utter.onend = onEnd;
  window.speechSynthesis.speak(utter);
}

/** Speak a full voice reply (may use multiple sentences up to VOICE_REPLY_MAX). */
export function speakVoiceReply(text, { onStart, onEnd } = {}) {
  speakText(text, { onStart, onEnd, maxLen: VOICE_REPLY_MAX });
}

/** Short status while the agent is working (catalog, transport, placing order). */
export function speakStatus(text) {
  const s = String(text || '').trim();
  if (!s || typeof window === 'undefined' || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(s.slice(0, 140));
  utter.rate = 1.15;
  utter.pitch = 1;
  utter.lang = 'en-IN';
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
}

/**
 * Continuous recognition for an active call.
 * Does NOT auto-submit on pause — only accumulates text until stop() is called.
 */
export function createCallSpeechRecognizer({
  onInterim,
  onFinal,
  onError,
  shouldKeepListening
} = {}) {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return { isSupported: false, start: () => {}, stop: () => '', abort: () => {} };
  }

  let recognition = null;
  let transcript = '';
  let active = false;
  let stopping = false;

  const flushTranscript = () => {
    const text = transcript.trim();
    transcript = '';
    return text;
  };

  const bindHandlers = (rec) => {
    rec.onresult = (event) => {
      let interim = '';
      let gotFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) {
          transcript = `${transcript} ${piece}`.trim();
          gotFinal = true;
        } else {
          interim += piece;
        }
      }
      const display = `${transcript} ${interim}`.trim() || transcript;
      onInterim?.(display);
      if (gotFinal && transcript) {
        onFinal?.(transcript);
      }
    };

    rec.onerror = (e) => {
      if (e.error === 'aborted' || stopping) return;
      onError?.(e);
    };

    rec.onend = () => {
      active = false;
      if (stopping) return;
      if (shouldKeepListening?.()) {
        try {
          recognition = new Ctor();
          recognition.lang = 'en-IN';
          recognition.interimResults = true;
          recognition.continuous = true;
          recognition.maxAlternatives = 1;
          bindHandlers(recognition);
          recognition.start();
          active = true;
        } catch {
          onError?.({ error: 'failed', message: 'Could not restart microphone' });
        }
      }
    };
  };

  const start = () => {
    stopping = false;
    transcript = '';
    recognition = new Ctor();
    recognition.lang = 'en-IN';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    bindHandlers(recognition);
    try {
      recognition.start();
      active = true;
    } catch (e) {
      active = false;
      onError?.({ error: 'failed', message: e?.message });
    }
  };

  const stop = () => {
    stopping = true;
    const text = flushTranscript();
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
    active = false;
    recognition = null;
    return text;
  };

  const abort = () => {
    stopping = true;
    transcript = '';
    try {
      recognition?.abort();
    } catch {
      /* ignore */
    }
    active = false;
    recognition = null;
  };

  const getTranscript = () => transcript.trim();

  return { isSupported: true, start, stop, abort, getTranscript, isActive: () => active };
}
