let speechUnlocked = false;
let cachedVoice = null;
let voicesWarmPromise = null;

const SPEECH_RATE =
  Number.parseFloat(String(import.meta.env.VITE_VOICE_SPEECH_RATE || '0.94')) || 0.94;
const SPEECH_PITCH =
  Number.parseFloat(String(import.meta.env.VITE_VOICE_SPEECH_PITCH || '1')) || 1;
const STATUS_RATE =
  Number.parseFloat(String(import.meta.env.VITE_VOICE_STATUS_RATE || '0.98')) || 0.98;
const CHUNK_PAUSE_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_CHUNK_PAUSE_MS || '320'), 10) || 320;
const SPEECH_CHUNK_MAX = 280;

export function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function scoreVoice(voice) {
  const name = String(voice?.name || '').toLowerCase();
  const lang = String(voice?.lang || '').toLowerCase();
  let score = 0;

  if (lang.startsWith('en-in')) score += 40;
  else if (lang.startsWith('en-gb')) score += 28;
  else if (lang.startsWith('en-us')) score += 24;
  else if (lang.startsWith('en')) score += 18;

  if (voice.localService) score += 12;
  if (/google/i.test(name)) score += 22;
  if (/microsoft|apple|amazon|natural|neural|premium|enhanced|online/i.test(name)) score += 30;
  if (/samantha|karen|daniel|rishi|veena|priya|moira|tessa|serena|zira|david|susan/i.test(name)) {
    score += 34;
  }
  if (/female|woman/i.test(name)) score += 4;
  if (/compact|espeak|android|bad news|bells|boing|whisper/i.test(name)) score -= 80;

  return score;
}

function pickBestVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;
  const ranked = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return ranked[0] || null;
}

/** Load system voices early so the first reply does not use a robotic default. */
export function preloadVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return Promise.resolve(null);
  }
  if (voicesWarmPromise) return voicesWarmPromise;

  voicesWarmPromise = new Promise((resolve) => {
    const finish = () => {
      cachedVoice = pickBestVoice();
      resolve(cachedVoice);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      finish();
      return;
    }

    const onChange = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onChange);
      finish();
    };
    window.speechSynthesis.addEventListener('voiceschanged', onChange);
    setTimeout(finish, 600);
  });

  return voicesWarmPromise;
}

/** Call from a user click so later async replies can use speechSynthesis (Chrome/Safari). */
export function unlockSpeech() {
  if (typeof window === 'undefined' || !window.speechSynthesis || speechUnlocked) return;
  try {
    void preloadVoices();
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

function applyUtterance(utter, { rate = SPEECH_RATE, pitch = SPEECH_PITCH } = {}) {
  const voice = cachedVoice || pickBestVoice();
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang || 'en-IN';
  } else {
    utter.lang = 'en-IN';
  }
  utter.rate = rate;
  utter.pitch = pitch;
  utter.volume = 1;
}

/** Normalize text so TTS sounds less robotic (numbers, abbreviations). */
export function humanizeForSpeech(text) {
  return (
    String(text || '')
      .replace(/\b(\d+)\s*km\b/gi, '$1 kilometers')
      .replace(/\b(\d+)\s*nos\b/gi, '$1 items')
      .replace(/\bnos\b/gi, 'items')
      .replace(/\bRs\.?\s*/gi, 'rupees ')
      .replace(/\bINR\s*/gi, 'rupees ')
      .replace(/\bCOD\b/g, 'cash on delivery')
      .replace(/\bPO\b/g, 'purchase order')
      .replace(/\bUPi\b/gi, 'U P I')
      .replace(/\s+/g, ' ')
      .trim()
  );
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
  const s = humanizeForSpeech(text);
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const dot = cut.lastIndexOf('.');
  return dot > 60 ? cut.slice(0, dot + 1) : `${cut.trim()}…`;
}

function splitForSpeech(text) {
  const s = humanizeForSpeech(text);
  if (!s) return [];
  const sentences = s.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [s];
  const chunks = [];
  let buf = '';
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    const next = buf ? `${buf} ${piece}` : piece;
    if (next.length > SPEECH_CHUNK_MAX && buf) {
      chunks.push(buf);
      buf = piece;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [s];
}

function speakUtterance(snippet, { onStart, onEnd, rate, pitch } = {}) {
  if (!snippet || typeof window === 'undefined' || !window.speechSynthesis) {
    onEnd?.();
    return false;
  }

  const utter = new SpeechSynthesisUtterance(snippet);
  applyUtterance(utter, { rate, pitch });
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

  const run = () => {
    applyUtterance(utter, { rate, pitch });
    start();
  };

  if (cachedVoice || window.speechSynthesis.getVoices().length) {
    run();
  } else {
    void preloadVoices().then(run);
  }
  return true;
}

export function speakText(text, { onStart, onEnd, maxLen = 220, rate = STATUS_RATE } = {}) {
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
  return speakUtterance(snippet, { onStart, onEnd, rate });
}

/** Speak the full agent reply with natural pacing between phrases. */
export function speakVoiceReply(text, { onStart, onEnd } = {}) {
  const parts = splitForSpeech(text);
  if (!parts.length) {
    onEnd?.();
    return false;
  }
  window.speechSynthesis.cancel();
  let index = 0;
  const speakNext = () => {
    if (index >= parts.length) {
      onEnd?.();
      return;
    }
    const isFirst = index === 0;
    const isLast = index === parts.length - 1;
    speakUtterance(parts[index], {
      rate: SPEECH_RATE,
      pitch: SPEECH_PITCH,
      onStart: isFirst ? onStart : undefined,
      onEnd: () => {
        index += 1;
        if (isLast) onEnd?.();
        else setTimeout(speakNext, CHUNK_PAUSE_MS);
      }
    });
  };

  void preloadVoices().then(speakNext);
  return true;
}

/** Short status while the agent is working (catalog, transport, placing order). */
export function speakStatus(text) {
  const s = String(text || '').trim();
  if (!s) return;
  speakText(s, { maxLen: 140, rate: STATUS_RATE });
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
