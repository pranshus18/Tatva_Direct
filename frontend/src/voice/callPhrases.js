/** Voice commands during an active call. */

export function isEndCallPhrase(text) {
  return /\b(end (the )?call|hang up|hangup|stop (the )?call|exit call|close call|disconnect call)\b/i.test(
    String(text || '').trim()
  );
}

/** User finished their turn — send to agent (does NOT end the call). */
export function isSendTurnPhrase(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/^(done speaking|i'?m done speaking|finished speaking|that'?s it|send it)$/i.test(t)) {
    return true;
  }
  return /\b(done speaking|send (?:that|it)|i'?m done)\b/i.test(t);
}

export function stripSendPhrase(text) {
  return String(text || '')
    .replace(/\b(done speaking|i'?m done speaking|finished speaking|send (?:that|it))\b/gi, '')
    .trim();
}
