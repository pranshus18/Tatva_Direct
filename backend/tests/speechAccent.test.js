import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSpeechLocale,
  SPEECH_LOCALE,
  scoreSpeechVoice
} from '../../frontend/src/voice/speechAccent.js';

test('maps each call language to India TTS locale', () => {
  assert.equal(resolveSpeechLocale('english'), 'en-IN');
  assert.equal(resolveSpeechLocale(null), 'en-IN');
  assert.equal(resolveSpeechLocale('hindi'), 'hi-IN');
  assert.equal(resolveSpeechLocale('kannada'), 'kn-IN');
  assert.equal(resolveSpeechLocale('telugu'), 'te-IN');
  assert.equal(resolveSpeechLocale('hinglish'), 'en-IN');
  assert.deepEqual(new Set(Object.keys(SPEECH_LOCALE)), new Set(['english', 'hinglish', 'hindi', 'kannada', 'telugu']));
});

test('script in reply overrides locale for mixed-language calls', () => {
  assert.equal(resolveSpeechLocale('english', 'ಸಿಮೆಂಟ್ ಸೇರಿಸಿ'), 'kn-IN');
  assert.equal(resolveSpeechLocale('english', 'సిమెంట్ జోడించండి'), 'te-IN');
  assert.equal(resolveSpeechLocale('english', 'सीमेंट जोड़ो'), 'hi-IN');
});

test('penalizes US/UK voices for Indic locales', () => {
  const us = { name: 'Google US English', lang: 'en-US', localService: true };
  const inVoice = { name: 'Rishi', lang: 'en-IN', localService: true };
  assert.ok(scoreSpeechVoice(inVoice, 'en-IN') > scoreSpeechVoice(us, 'en-IN'));
  assert.ok(scoreSpeechVoice(inVoice, 'hi-IN') > scoreSpeechVoice(us, 'hi-IN'));
});
