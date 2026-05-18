/**
 * Optional external STT — POST { chunk, final } → { text, partial }.
 * Set VOICE_PYTHON_URL to the service base URL (e.g. http://127.0.0.1:8765).
 */

const PYTHON_URL = String(process.env.VOICE_PYTHON_URL || '').replace(/\/$/, '');
const TIMEOUT_MS = Number.parseInt(String(process.env.VOICE_STT_TIMEOUT_MS || '15000'), 10) || 15000;

export const whisperService = {
  isEnabled() {
    return Boolean(PYTHON_URL);
  },

  async transcribePcmBase64(chunkB64, { final = false } = {}) {
    if (!PYTHON_URL) return { text: '', partial: '' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${PYTHON_URL}/stt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunk: chunkB64, final }),
        signal: controller.signal
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'STT failed');
      return { text: data.text || '', partial: data.partial || data.text || '' };
    } catch (err) {
      return { text: '', partial: '', error: err.message };
    } finally {
      clearTimeout(timeout);
    }
  }
};
