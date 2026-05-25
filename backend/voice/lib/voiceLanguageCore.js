/** Browser-safe language ids, aliases, and parsing (no Node APIs). */

export const VOICE_LANGUAGES = {
  english: { id: 'english', label: 'English', sttLocale: 'en-IN', ttsLocale: 'en-IN' },
  hinglish: { id: 'hinglish', label: 'Hinglish', sttLocale: 'en-IN', ttsLocale: 'en-IN' },
  hindi: { id: 'hindi', label: 'Hindi', sttLocale: 'hi-IN', ttsLocale: 'hi-IN' },
  kannada: { id: 'kannada', label: 'Kannada', sttLocale: 'kn-IN', ttsLocale: 'kn-IN' },
  telugu: { id: 'telugu', label: 'Telugu', sttLocale: 'te-IN', ttsLocale: 'te-IN' }
};

/** Language name as spoken in each UI language (for post-selection thank-you). */
export const LANGUAGE_LABELS_BY_UI_LANG = {
  english: {
    english: 'English',
    hinglish: 'Hinglish',
    hindi: 'Hindi',
    kannada: 'Kannada',
    telugu: 'Telugu'
  },
  hinglish: {
    english: 'English',
    hinglish: 'Hinglish',
    hindi: 'Hindi',
    kannada: 'Kannada',
    telugu: 'Telugu'
  },
  hindi: {
    english: 'अंग्रेज़ी',
    hinglish: 'Hinglish',
    hindi: 'हिंदी',
    kannada: 'कन्नड़',
    telugu: 'तेलुगु'
  },
  kannada: {
    english: 'ಇಂಗ್ಲಿಷ್',
    hinglish: 'Hinglish',
    hindi: 'ಹಿಂದಿ',
    kannada: 'ಕನ್ನಡ',
    telugu: 'ತೆಲುಗು'
  },
  telugu: {
    english: 'ఇంగ్లీష్',
    hinglish: 'Hinglish',
    hindi: 'హిందీ',
    kannada: 'కన్నడ',
    telugu: 'తెలుగు'
  }
};

export const LANGUAGE_ALIASES = new Map([
  ['english', 'english'],
  ['eng', 'english'],
  ['en', 'english'],
  ['hindi', 'hindi'],
  ['hindhi', 'hindi'],
  ['hin', 'hindi'],
  ['हिंदी', 'hindi'],
  ['हिन्दी', 'hindi'],
  ['kannada', 'kannada'],
  ['kannad', 'kannada'],
  ['kanada', 'kannada'],
  ['kn', 'kannada'],
  ['ಕನ್ನಡ', 'kannada'],
  ['telugu', 'telugu'],
  ['telegu', 'telugu'],
  ['telgu', 'telugu'],
  ['te', 'telugu'],
  ['తెలుగు', 'telugu'],
  ['hinglish', 'hinglish'],
  ['हिंग्लिश', 'hinglish']
]);

export const SWITCH_PATTERNS = [
  /\b(?:switch|change|set|speak|talk)(?:\s+language)?\s+(?:to|in)\s+(english|hinglish|hindi|kannada|telugu)\b/i,
  /\b(english|hinglish|hindi|kannada|telugu)\s+(?:please|language)\b/i,
  /\b(?:hindi|kannada|telugu|english|hinglish)\s+(?:mein|me|nalli|lo|లో|ನಲ್ಲಿ|లో మాట్లాడండి|ನಲ್ಲಿ ಮಾತನಾಡಿ)\b/i,
  /\b(हिंदी|कन्नड़|तेलुगु|अंग्रेज़ी|हिंग्लिश|hinglish)\s+(?:में|मे)?\b/i
];

export function normalizeVoiceLanguage(lang) {
  const key = String(lang || '').trim().toLowerCase();
  const mapped = LANGUAGE_ALIASES.get(key) || key;
  return VOICE_LANGUAGES[mapped] ? mapped : null;
}

export function getVoiceLanguageMeta(language) {
  const id = normalizeVoiceLanguage(language) || 'english';
  return VOICE_LANGUAGES[id] || VOICE_LANGUAGES.english;
}

export function getLanguageLabelForVoice(languageId, uiLanguage = null) {
  const id = normalizeVoiceLanguage(languageId) || 'english';
  const ui = normalizeVoiceLanguage(uiLanguage) || id;
  return LANGUAGE_LABELS_BY_UI_LANG[ui]?.[id] || VOICE_LANGUAGES[id]?.label || id;
}

export function parseVoiceLanguageFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase().replace(/[.!?,]+$/g, '').trim();
  const direct = normalizeVoiceLanguage(lowered);
  if (direct) return direct;

  const wordMatch = lowered.match(
    /\b(english|hinglish|hindi|kannada|telugu|हिंदी|हिन्दी|हिंग्लिश|ಕನ್ನಡ|తెలుగు)\b/i
  );
  if (wordMatch) {
    const guessed = normalizeVoiceLanguage(wordMatch[1]);
    if (guessed) return guessed;
  }

  for (const re of SWITCH_PATTERNS) {
    const m = lowered.match(re);
    if (!m) continue;
    const guessed = normalizeVoiceLanguage(m[1] || m[0]);
    if (guessed) return guessed;
  }
  return null;
}
