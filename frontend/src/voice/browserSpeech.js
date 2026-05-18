let speechUnlocked = false;

export function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Call from a user click so later async replies can use speechSynthesis (Chrome/Safari). */
export function unlockSpeech() {
  if (typeof window === 'undefined' || !window.speechSynthesis || speechUnlocked) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0.01;
    u.lang = 'en-IN';
    window.speechSynthesis.speak(u);
    window.speechSynthesis.cancel();
    speechUnlocked = true;
  } catch {
    /* ignore */
  }
}

function pickVoice(lang = 'en-IN') {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const prefer = voices.find((v) => v.lang?.startsWith('en') && /india|en-in/i.test(v.lang));
  if (prefer) return prefer;
  return voices.find((v) => v.lang?.startsWith('en')) || voices[0] || null;
}

function applyUtterance(utter) {
  const voice = pickVoice(utter.lang);
  if (voice) utter.voice = voice;
  utter.rate = 1.05;
  utter.pitch = 1;
  utter.volume = 1;
}

/** Chrome sometimes drops the first speak() after async WS — nudge the queue. */
function nudgeSpeechSynthesis() {
  try {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }
  } catch {
    /* ignore */
  }
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
    return false;
  }
  const snippet = speechSnippet(text, maxLen);
  if (!snippet) {
    onEnd?.();
    return false;
  }

  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(snippet);
  utter.lang = 'en-IN';
  applyUtterance(utter);
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    onEnd?.();
  };
  utter.onstart = () => {
    onStart?.();
    setTimeout(nudgeSpeechSynthesis, 50);
  };
  utter.onend = finish;
  utter.onerror = finish;

  const start = () => {
    window.speechSynthesis.speak(utter);
    setTimeout(nudgeSpeechSynthesis, 120);
  };

  const voices = window.speechSynthesis.getVoices();
  if (voices.length) {
    start();
  } else {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      applyUtterance(utter);
      start();
    };
    start();
  }
  return true;
}

/** Speak a full voice reply (may use multiple sentences up to VOICE_REPLY_MAX). */
export function speakVoiceReply(text, { onStart, onEnd } = {}) {
  return speakText(text, { onStart, onEnd, maxLen: VOICE_REPLY_MAX });
}

/** Short status while the agent is working (catalog, transport, placing order). */
export function speakStatus(text) {
  const s = String(text || '').trim();
  if (!s) return;
  speakText(s, { maxLen: 140 });
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
