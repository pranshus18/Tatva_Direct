/** Voice Gemini models — uses GEMINI_MODEL from .env (e.g. gemini-2.5-pro), with flash fallbacks. */

const normalizeModel = (m) => String(m).replace(/^models\//, '').trim();

const FLASH_DEFAULTS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

function withFallbacks(primary) {
  const rest = FLASH_DEFAULTS.filter((m) => m !== primary);
  return primary ? [primary, ...rest] : [...FLASH_DEFAULTS];
}

/**
 * Model list for voice chat / RAG (not TTS — see gemini_tts_service.js).
 * Priority: VOICE_GEMINI_MODEL → GEMINI_MODEL → flash defaults.
 */
export function resolveVoiceModels() {
  const voiceOnly = normalizeModel(process.env.VOICE_GEMINI_MODEL || '');
  if (voiceOnly) return withFallbacks(voiceOnly);

  const appModel = normalizeModel(process.env.GEMINI_MODEL || '');
  if (appModel) return withFallbacks(appModel);

  return [...FLASH_DEFAULTS];
}

export function primaryVoiceModel() {
  return resolveVoiceModels()[0];
}

/** Pro models need more time than flash for voice turns. */
export function resolveVoiceGeminiTimeoutMs() {
  const explicit = Number.parseInt(String(process.env.VOICE_GEMINI_TIMEOUT_MS || ''), 10);
  if (explicit > 0) return explicit;
  const primary = primaryVoiceModel();
  return /pro/i.test(primary) ? 22000 : 8000;
}
