/** Voice commands that end the active call (matches call bar button labels). */

function normalizeSpeech(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s\u0900-\u097f\u0c80-\u0cff\u0c00-\u0c7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isEndCallPhrase(text) {
  const t = normalizeSpeech(text);
  if (!t) return false;
  if (
    /^(please )?(done speaking|i'?m done speaking|finished speaking|end call|end the call|end this call|hang up|hangup|stop call|stop the call|exit call|close call|disconnect call|call band karo|कॉल बंद करो|కాల్ ముగించు|ಕಾಲ್ ಮುಗಿಸಿ)( please| now)?$/i.test(
      t
    )
  ) {
    return true;
  }
  return /\b(done speaking|i'?m done speaking|finished speaking|end (the |this )?call|hang up|hangup|stop (the )?call|exit call|close call|disconnect call|call band karo|कॉल बंद करो|కాల్ ముగించు|ಕಾಲ್ ಮುಗಿಸಿ)\b/i.test(
    t
  );
}

/** Optional aliases to submit speech without ending the call. */
export function isSendTurnPhrase(text) {
  if (isEndCallPhrase(text)) return false;
  const t = String(text || '').trim().toLowerCase();
  if (/^(that'?s it|send it)$/i.test(t)) return true;
  return /\b(send (?:that|it))\b/i.test(t);
}

export function stripSendPhrase(text) {
  return String(text || '')
    .replace(/\b(send (?:that|it))\b/gi, '')
    .trim();
}
