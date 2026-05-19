/** Voice commands that end the active call (matches call bar button labels). */

export function isEndCallPhrase(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (
    /^(done speaking|i'?m done speaking|finished speaking|end call|end the call|hang up|hangup|stop call|stop the call|exit call|close call|disconnect call)$/i.test(
      t
    )
  ) {
    return true;
  }
  return /\b(done speaking|i'?m done speaking|finished speaking|end (the )?call|hang up|hangup|stop (the )?call|exit call|close call|disconnect call)\b/i.test(
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
