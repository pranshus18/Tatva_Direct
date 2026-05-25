const MAX_CHARS = Number.parseInt(String(process.env.VOICE_TTS_CHUNK_CHARS || '640'), 10) || 640;

/** Split reply into TTS-sized phrases (Indic + Latin punctuation). */
export function splitTextForTts(text, maxChars = MAX_CHARS) {
  const s = String(text || '').trim();
  if (!s) return [];
  if (s.length <= maxChars) return [s];

  const parts = s.split(/(?<=[.!?।]\s+)/).filter(Boolean);
  const chunks = [];
  let buf = '';

  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    const next = buf ? `${buf} ${piece}` : piece;
    if (next.length > maxChars && buf) {
      chunks.push(buf);
      buf = piece;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);

  if (!chunks.length) return [s.slice(0, maxChars)];
  return chunks;
}
