import {
  getProsodyForLocale,
  pickSpeechVoice,
  rankVoicesForLocale,
  resolveSpeechLocale,
  scoreSpeechVoice
} from './speechAccent.js';

let speechUnlocked = false;
const voiceCacheByLocale = new Map();
const warmPromisesByLocale = new Map();
let activeSpeechLocale = 'en-IN';
let activeLanguageId = 'english';

const DEFAULT_RATE =
  Number.parseFloat(String(import.meta.env.VITE_VOICE_SPEECH_RATE || '0.9')) || 0.9;
const DEFAULT_PITCH =
  Number.parseFloat(String(import.meta.env.VITE_VOICE_SPEECH_PITCH || '1.03')) || 1.03;
const STATUS_RATE =
  Number.parseFloat(String(import.meta.env.VITE_VOICE_STATUS_RATE || '0.95')) || 0.95;
const CHUNK_PAUSE_MS =
  Number.parseInt(String(import.meta.env.VITE_VOICE_CHUNK_PAUSE_MS || '120'), 10) || 120;
const SPEECH_CHUNK_MAX = 190;

const VOICE_DEBUG =
  typeof localStorage !== 'undefined' && localStorage.getItem('VOICE_DEBUG') === '1';

export function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function getVoicesList() {
  return window.speechSynthesis?.getVoices?.() || [];
}

function cachedVoiceForLocale(locale) {
  return voiceCacheByLocale.get(String(locale || 'en-IN').toLowerCase()) || null;
}

function setCachedVoice(locale, voice) {
  voiceCacheByLocale.set(String(locale || 'en-IN').toLowerCase(), voice || null);
}

function resolveLocale(locale, text, languageId) {
  if (locale) return String(locale);
  if (languageId) return resolveSpeechLocale(languageId, text);
  return resolveSpeechLocale(activeLanguageId, text);
}

function logVoicePick(locale, voice, textSample) {
  if (!VOICE_DEBUG || !voice) return;
  console.log('[voice TTS]', {
    locale,
    voice: `${voice.name} (${voice.lang})`,
    score: scoreSpeechVoice(voice, locale),
    sample: String(textSample || '').slice(0, 60),
    alternates: rankVoicesForLocale(getVoicesList(), locale, 3)
  });
}

export function preloadVoices(locale = activeSpeechLocale) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return Promise.resolve(null);
  }

  const key = String(locale || 'en-IN').toLowerCase();
  if (warmPromisesByLocale.has(key)) return warmPromisesByLocale.get(key);

  const promise = new Promise((resolve) => {
    const finish = () => {
      const voices = getVoicesList();
      const picked = pickSpeechVoice(voices, key);
      setCachedVoice(key, picked);
      logVoicePick(key, picked, '');
      resolve(picked);
    };

    const voices = getVoicesList();
    if (voices.length >= 3) {
      finish();
      return;
    }

    let attempts = 0;
    const onChange = () => {
      attempts += 1;
      const v = getVoicesList();
      if (v.length >= 3 || attempts > 5) {
        window.speechSynthesis.removeEventListener('voiceschanged', onChange);
        finish();
      }
    };
    window.speechSynthesis.addEventListener('voiceschanged', onChange);
    window.speechSynthesis.getVoices();
    setTimeout(finish, 900);
  });

  warmPromisesByLocale.set(key, promise);
  return promise;
}

export function unlockSpeech(locale = activeSpeechLocale) {
  if (typeof window === 'undefined' || !window.speechSynthesis || speechUnlocked) return;
  try {
    void preloadVoices(locale);
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0.01;
    u.lang = locale || 'en-IN';
    const v = cachedVoiceForLocale(locale) || pickSpeechVoice(getVoicesList(), locale);
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
    window.speechSynthesis.cancel();
    speechUnlocked = true;
  } catch {
    /* ignore */
  }
}

function applyUtterance(utter, { rate, pitch, locale = activeSpeechLocale } = {}) {
  const loc = String(locale || 'en-IN');
  const prosody = getProsodyForLocale(loc);
  let voice = cachedVoiceForLocale(loc);
  if (!voice) {
    voice = pickSpeechVoice(getVoicesList(), loc);
    setCachedVoice(loc, voice);
  }

  utter.lang = loc;
  if (voice) {
    utter.voice = voice;
    if (voice.lang) utter.lang = voice.lang;
  }

  utter.rate = rate ?? prosody.rate ?? DEFAULT_RATE;
  utter.pitch = pitch ?? prosody.pitch ?? DEFAULT_PITCH;
  utter.volume = 1;
}

export function humanizeForSpeech(text, locale = activeSpeechLocale) {
  let s = String(text || '').trim();
  if (!s) return '';

  s = s
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s*–\s*/g, ', ')
    .replace(/\s*;\s*/g, '. ')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const loc = String(locale || 'en-IN').toLowerCase();
  const isLatinHeavy = !/[\u0900-\u097F\u0C80-\u0CFF\u0C00-\u0C7F]/.test(s);

  if (isLatinHeavy || loc.startsWith('en')) {
    s = s
      .replace(/\b(\d+)\s*km\b/gi, '$1 kilometers')
      .replace(/\b(\d+)\s*nos\b/gi, '$1 pieces')
      .replace(/\bnos\b/gi, 'pieces')
      .replace(/\bRs\.?\s*/gi, 'rupees ')
      .replace(/\bINR\s*/gi, 'rupees ')
      .replace(/\bCOD\b/g, 'cash on delivery')
      .replace(/\bPO\b/g, 'purchase order')
      .replace(/\bUPI\b/gi, 'U P I');
  }

  return s.replace(/\s+/g, ' ').trim();
}

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

export function speechSnippet(text, maxLen = 220, locale = activeSpeechLocale, languageId = null) {
  const loc = resolveLocale(locale, text, languageId);
  const s = humanizeForSpeech(text, loc);
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const dot = cut.lastIndexOf('.');
  const qm = cut.lastIndexOf('?');
  const stop = Math.max(dot, qm);
  return stop > 50 ? cut.slice(0, stop + 1) : `${cut.trim()}…`;
}

function splitForSpeech(text, locale, languageId) {
  const loc = resolveLocale(locale, text, languageId);
  const s = humanizeForSpeech(text, loc);
  if (!s) return [];

  const rawParts = s.split(/(?<=[.!?।])\s+/).filter(Boolean);
  const chunks = [];
  let buf = '';

  for (const part of rawParts) {
    const piece = part.trim();
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

function speakUtterance(snippet, { onStart, onEnd, rate, pitch, locale, languageId } = {}) {
  if (!snippet || typeof window === 'undefined' || !window.speechSynthesis) {
    onEnd?.();
    return false;
  }

  const loc = resolveLocale(locale, snippet, languageId);
  const utter = new SpeechSynthesisUtterance(snippet);
  applyUtterance(utter, { rate, pitch, locale: loc });

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

  const run = () => {
    applyUtterance(utter, { rate, pitch, locale: loc });
    logVoicePick(loc, utter.voice || cachedVoiceForLocale(loc), snippet);
    window.speechSynthesis.speak(utter);
    setTimeout(nudgeSpeechSynthesis, 120);
  };

  if (cachedVoiceForLocale(loc) || getVoicesList().length) {
    run();
  } else {
    void preloadVoices(loc).then(run);
  }
  return true;
}

export function speakText(text, { onStart, onEnd, maxLen = 220, rate, locale, languageId } = {}) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) {
    onEnd?.();
    return false;
  }
  const loc = resolveLocale(locale, text, languageId);
  const snippet = speechSnippet(text, maxLen, loc, languageId);
  if (!snippet) {
    onEnd?.();
    return false;
  }
  window.speechSynthesis.cancel();
  const prosody = getProsodyForLocale(loc);
  return speakUtterance(snippet, {
    onStart,
    onEnd,
    rate: rate ?? prosody.rate,
    pitch: prosody.pitch,
    locale: loc,
    languageId
  });
}

/**
 * @param {object} opts
 * @param {string} [opts.locale] - BCP-47 (hi-IN, kn-IN, …)
 * @param {string} [opts.languageId] - english | hindi | kannada | telugu
 */
export function speakVoiceReply(text, { onStart, onEnd, locale, languageId } = {}) {
  const loc = resolveLocale(locale, text, languageId || activeLanguageId);
  const parts = splitForSpeech(text, loc, languageId || activeLanguageId);
  if (!parts.length) {
    onEnd?.();
    return false;
  }
  window.speechSynthesis.cancel();
  const prosody = getProsodyForLocale(loc);
  let index = 0;

  const speakNext = () => {
    if (index >= parts.length) {
      onEnd?.();
      return;
    }
    const isFirst = index === 0;
    const isLast = index === parts.length - 1;
    speakUtterance(parts[index], {
      rate: prosody.rate,
      pitch: prosody.pitch,
      locale: loc,
      languageId: languageId || activeLanguageId,
      onStart: isFirst ? onStart : undefined,
      onEnd: () => {
        index += 1;
        if (isLast) onEnd?.();
        else setTimeout(speakNext, CHUNK_PAUSE_MS);
      }
    });
  };

  void preloadVoices(loc).then(speakNext);
  return true;
}

export function speakStatus(text, locale, languageId) {
  const s = String(text || '').trim();
  if (!s) return;
  speakText(s, {
    maxLen: 120,
    rate: STATUS_RATE,
    locale,
    languageId: languageId || activeLanguageId
  });
}

/** Set active call language for accent (prefer languageId over raw BCP-47). */
export function setSpeechLocale(locale, languageId = null) {
  activeSpeechLocale = String(locale || 'en-IN');
  if (languageId) activeLanguageId = languageId;
  const loc = resolveSpeechLocale(activeLanguageId, '');
  activeSpeechLocale = loc;
  warmPromisesByLocale.delete(loc.toLowerCase());
  voiceCacheByLocale.delete(loc.toLowerCase());
  void preloadVoices(loc);
}

export function setSpeechLanguage(languageId) {
  const id = languageId || 'english';
  activeLanguageId = id;
  const loc = resolveSpeechLocale(id, '');
  activeSpeechLocale = loc;
  warmPromisesByLocale.delete(loc.toLowerCase());
  voiceCacheByLocale.delete(loc.toLowerCase());
  void preloadVoices(loc);
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
}

export function createCallSpeechRecognizer({
  onInterim,
  onFinal,
  onError,
  shouldKeepListening,
  locale = 'en-IN'
} = {}) {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return { isSupported: false, start: () => {}, stop: () => '', abort: () => {} };
  }

  let recognition = null;
  let transcript = '';
  let active = false;
  let stopping = false;
  let activeLocale = String(locale || 'en-IN');

  const pickBestPiece = (result) => {
    const candidates = [];
    for (let i = 0; i < result.length; i += 1) {
      const text = String(result[i]?.transcript || '').trim();
      if (!text) continue;
      const conf = Number(result[i]?.confidence);
      candidates.push({
        text,
        conf: Number.isFinite(conf) ? conf : (i === 0 ? 0.92 : 0.55 - i * 0.08)
      });
    }
    if (!candidates.length) return '';
    candidates.sort((a, b) => b.conf - a.conf || b.text.length - a.text.length);
    return candidates[0].text;
  };

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
        const piece = pickBestPiece(event.results[i]);
        if (!piece) continue;
        if (event.results[i].isFinal) {
          transcript = transcript ? `${transcript} ${piece}`.trim() : piece;
          gotFinal = true;
        } else {
          interim += (interim ? ' ' : '') + piece;
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
          recognition.lang = activeLocale;
          recognition.interimResults = true;
          recognition.continuous = true;
          recognition.maxAlternatives = 5;
          bindHandlers(recognition);
          recognition.start();
          active = true;
        } catch {
          onError?.({ error: 'failed', message: 'Could not restart microphone' });
        }
      }
    };
  };

  const applyLocale = (nextLocale) => {
    const loc = String(nextLocale || 'en-IN');
    if (loc === activeLocale) return;
    activeLocale = loc;
    if (!active || stopping) return;
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
  };

  const start = () => {
    stopping = false;
    transcript = '';
    activeLocale = String(locale || 'en-IN');
    recognition = new Ctor();
    recognition.lang = activeLocale;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 5;
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

  return {
    isSupported: true,
    start,
    stop,
    abort,
    getTranscript,
    setLocale: applyLocale,
    isActive: () => active
  };
}
