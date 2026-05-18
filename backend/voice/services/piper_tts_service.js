/**
 * Optional external streaming TTS — POST { text } → NDJSON { chunk } lines.
 */

const PYTHON_URL = String(process.env.VOICE_PYTHON_URL || '').replace(/\/$/, '');
const TIMEOUT_MS = Number.parseInt(String(process.env.VOICE_TTS_TIMEOUT_MS || '20000'), 10) || 20000;

export const piperTtsService = {
  isEnabled() {
    return Boolean(PYTHON_URL);
  },

  /** Yields base64 PCM chunks via callback. */
  async streamSpeak(text, onAudioChunk) {
    if (!PYTHON_URL || !text?.trim()) return false;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${PYTHON_URL}/tts/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: String(text).slice(0, 500) }),
        signal: controller.signal
      });

      if (!res.ok) return false;

      const reader = res.body?.getReader();
      if (!reader) {
        const data = await res.json();
        if (data.chunk) onAudioChunk(data.chunk);
        return true;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.chunk) onAudioChunk(msg.chunk);
          } catch {
            /* ndjson line */
          }
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
};
