export function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function speakText(text, { onStart, onEnd } = {}) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  utter.lang = 'en-IN';
  if (onStart) utter.onstart = onStart;
  if (onEnd) utter.onend = onEnd;
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
}

/**
 * @returns {{ start: () => void, stop: () => string, isSupported: boolean }}
 */
export function createSpeechRecognizer({ onInterim, onError } = {}) {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return { isSupported: false, start: () => {}, stop: () => '' };
  }

  let recognition = null;
  let lastFinal = '';
  let active = false;

  const start = () => {
    lastFinal = '';
    recognition = new Ctor();
    recognition.lang = 'en-IN';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalChunk += t;
        else interim += t;
      }
      if (finalChunk) lastFinal = `${lastFinal} ${finalChunk}`.trim();
      onInterim?.(interim || lastFinal);
    };

    recognition.onerror = (e) => {
      if (e.error !== 'aborted') onError?.(e);
    };

    recognition.onend = () => {
      if (active) {
        try {
          recognition.start();
        } catch {
          /* restart loop */
        }
      }
    };

    active = true;
    recognition.start();
  };

  const stop = () => {
    active = false;
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
    const out = lastFinal.trim();
    lastFinal = '';
    return out;
  };

  return { isSupported: true, start, stop };
}
