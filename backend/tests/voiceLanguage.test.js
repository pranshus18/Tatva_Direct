import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getVoiceLanguageMeta,
  normalizeVoiceLanguage,
  parseVoiceLanguageFromText,
  resolveDefaultVoiceLanguage
} from '../voice/lib/voiceLanguage.js';
import { getVoiceText } from '../voice/i18n/index.js';

test('normalizes supported languages', () => {
  assert.equal(normalizeVoiceLanguage('English'), 'english');
  assert.equal(normalizeVoiceLanguage('हिंदी'), 'hindi');
  assert.equal(normalizeVoiceLanguage('ಕನ್ನಡ'), 'kannada');
  assert.equal(normalizeVoiceLanguage('తెలుగు'), 'telugu');
  assert.equal(normalizeVoiceLanguage('hinglish'), 'hinglish');
  assert.equal(parseVoiceLanguageFromText('Hinglish'), 'hinglish');
});

test('parses language switch utterances', () => {
  assert.equal(parseVoiceLanguageFromText('switch to hindi'), 'hindi');
  assert.equal(parseVoiceLanguageFromText('please change language to telugu'), 'telugu');
  assert.equal(parseVoiceLanguageFromText('kannada language'), 'kannada');
  assert.equal(parseVoiceLanguageFromText('Hindi.'), 'hindi');
  assert.equal(parseVoiceLanguageFromText('I want hindi'), 'hindi');
  assert.equal(parseVoiceLanguageFromText('use kannada please'), 'kannada');
});

test('returns language metadata and sane default', () => {
  const fallback = resolveDefaultVoiceLanguage();
  const meta = getVoiceLanguageMeta(fallback);
  assert.ok(meta.sttLocale);
  assert.ok(meta.ttsLocale);
});

test('i18n falls back to english when key missing', () => {
  const text = getVoiceText('search.single', 'kannada', { productName: 'Cement' }, '');
  assert.match(text, /Cement/);
});
