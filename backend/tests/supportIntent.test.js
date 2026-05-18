import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionType } from '../voice/core/routeTypes.js';
import { intentRouter } from '../voice/services/intent_router.js';
import {
  isProceduralPolicyQuestion,
  resolveTrackOrderAction,
  shouldUseSupportRag
} from '../voice/lib/supportIntent.js';

test('isProceduralPolicyQuestion detects how/what questions', () => {
  assert.equal(isProceduralPolicyQuestion('how do I get a refund'), true);
  assert.equal(isProceduralPolicyQuestion('track order ABC-99'), false);
});

test('resolveTrackOrderAction sends how-to questions to support RAG', () => {
  assert.equal(resolveTrackOrderAction('how can I track my order'), ActionType.SUPPORT_RAG);
  assert.equal(resolveTrackOrderAction('track order PO-12345'), ActionType.TRACK_ORDER);
  assert.equal(resolveTrackOrderAction('my recent orders'), ActionType.TRACK_ORDER);
});

test('intentRouter routes procedural track questions to SMART support', () => {
  const d = intentRouter.route('how can I track my order');
  assert.equal(d.route, 'smart');
  assert.equal(d.action, ActionType.SUPPORT_RAG);
});

test('intentRouter routes track with order id to FAST track', () => {
  const d = intentRouter.route('track order PO-8821');
  assert.equal(d.route, 'fast');
  assert.equal(d.action, ActionType.TRACK_ORDER);
});

test('shouldUseSupportRag covers damaged goods without keyword list gaps', () => {
  assert.equal(shouldUseSupportRag('my items arrived damaged what do I do'), true);
});
