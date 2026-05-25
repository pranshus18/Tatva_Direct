export const VOICE_LANGUAGES = {
  english: { id: 'english', label: 'English', sttLocale: 'en-IN', ttsLocale: 'en-IN' },
  hinglish: { id: 'hinglish', label: 'Hinglish', sttLocale: 'en-IN', ttsLocale: 'en-IN' },
  hindi: { id: 'hindi', label: 'Hindi', sttLocale: 'hi-IN', ttsLocale: 'hi-IN' },
  kannada: { id: 'kannada', label: 'Kannada', sttLocale: 'kn-IN', ttsLocale: 'kn-IN' },
  telugu: { id: 'telugu', label: 'Telugu', sttLocale: 'te-IN', ttsLocale: 'te-IN' }
};

const DEFAULT_ID = String(import.meta.env?.VITE_VOICE_LANGUAGE_MODE || 'english').toLowerCase();

const ALIASES = new Map([
  ['english', 'english'],
  ['en', 'english'],
  ['hindi', 'hindi'],
  ['hi', 'hindi'],
  ['kannada', 'kannada'],
  ['kn', 'kannada'],
  ['telugu', 'telugu'],
  ['te', 'telugu'],
  ['hinglish', 'hinglish']
]);

export function normalizeVoiceLanguage(value) {
  const key = String(value || '').trim().toLowerCase();
  const mapped = ALIASES.get(key) || key;
  return VOICE_LANGUAGES[mapped] ? mapped : null;
}

export function getDefaultVoiceLanguage() {
  return normalizeVoiceLanguage(DEFAULT_ID) || 'english';
}

export function getVoiceLanguageMeta(value) {
  const id = normalizeVoiceLanguage(value) || getDefaultVoiceLanguage();
  return VOICE_LANGUAGES[id];
}
