/** Voice latency: gemini-1.5-flash default (Amazon-style). App GEMINI_MODEL pro is NOT used unless opted in. */

const normalizeModel = (m) => String(m).replace(/^models\//, '').trim();

const FLASH_DEFAULTS = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash'];

export function resolveVoiceModels() {
  const voiceOnly = normalizeModel(process.env.VOICE_GEMINI_MODEL || '');
  if (voiceOnly) return [voiceOnly, ...FLASH_DEFAULTS.filter((m) => m !== voiceOnly)];

  const useApp = String(process.env.VOICE_USE_APP_GEMINI_MODEL || '').toLowerCase() === 'true';
  const appModel = normalizeModel(process.env.GEMINI_MODEL || '');
  if (useApp && appModel && !/pro/i.test(appModel)) {
    return [appModel, ...FLASH_DEFAULTS.filter((m) => m !== appModel)];
  }

  return [...FLASH_DEFAULTS];
}

export function primaryVoiceModel() {
  return resolveVoiceModels()[0];
}
