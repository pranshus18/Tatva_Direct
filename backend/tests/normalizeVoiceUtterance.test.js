import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLikelySpeechNoise,
  normalizeVoiceUtterance
} from '../voice/lib/normalizeVoiceUtterance.js';

test('normalizeVoiceUtterance fixes common STT mistakes', () => {
  assert.equal(normalizeVoiceUtterance('add to car'), 'add to cart');
  assert.equal(normalizeVoiceUtterance('simant'), 'cement');
  assert.equal(normalizeVoiceUtterance('to'), '2');
  assert.equal(normalizeVoiceUtterance('mak air'), 'mac air');
});

test('isLikelySpeechNoise rejects unrelated STT hallucinations', () => {
  assert.equal(isLikelySpeechNoise('bangla song'), true);
  assert.equal(isLikelySpeechNoise('cement'), false);
  assert.equal(isLikelySpeechNoise('add 2 cement to cart'), false);
});

test('isLikelySpeechNoise allows bare quantity digits for cart', () => {
  assert.equal(isLikelySpeechNoise('2'), false);
  assert.equal(isLikelySpeechNoise('5'), false);
  assert.equal(isLikelySpeechNoise('10'), false);
});
