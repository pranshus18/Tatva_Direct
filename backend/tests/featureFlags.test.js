import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBooleanEnv } from '../utils/featureFlags.js';

function restoreEnvVar(name, previousValue) {
  if (typeof previousValue === 'undefined') {
    delete process.env[name];
    return;
  }
  process.env[name] = previousValue;
}

test('parseBooleanEnv respects default when variable is missing', () => {
  const key = 'TEST_FLAG_MISSING';
  const previousValue = process.env[key];
  delete process.env[key];

  assert.equal(parseBooleanEnv(key, false), false);
  assert.equal(parseBooleanEnv(key, true), true);

  restoreEnvVar(key, previousValue);
});

test('parseBooleanEnv handles true-like and false-like values', () => {
  const key = 'TEST_FLAG_VALUES';
  const previousValue = process.env[key];

  process.env[key] = 'true';
  assert.equal(parseBooleanEnv(key, false), true);
  process.env[key] = '1';
  assert.equal(parseBooleanEnv(key, false), true);
  process.env[key] = 'false';
  assert.equal(parseBooleanEnv(key, true), false);
  process.env[key] = '0';
  assert.equal(parseBooleanEnv(key, true), false);

  restoreEnvVar(key, previousValue);
});

test('parseBooleanEnv falls back when value is invalid', () => {
  const key = 'TEST_FLAG_INVALID';
  const previousValue = process.env[key];
  process.env[key] = 'definitely';

  assert.equal(parseBooleanEnv(key, false), false);
  assert.equal(parseBooleanEnv(key, true), true);

  restoreEnvVar(key, previousValue);
});

