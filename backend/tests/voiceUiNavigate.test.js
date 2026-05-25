import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionMemory, newSessionId } from '../voice/sessionMemory.js';
import {
  resolveVoiceUiScreenForNavigate,
  resolveVoiceUiScreenFromReply
} from '../voice/lib/voice_ui_screens.js';
import {
  promptAskQuantity,
  promptCartContinue,
  promptDiscoveryCartHandoff
} from '../voice/lib/voice_prompts.js';
import { enterDiscoveryFlow } from '../voice/lib/voice_flow_mode.js';

test('reply text with Step prefix maps to cart', () => {
  const screen = resolveVoiceUiScreenFromReply(promptCartContinue());
  assert.equal(screen?.path, '/cart');
});

test('pending await_discovery_cart_handoff navigates to cart without Step in reply', () => {
  const memory = new SessionMemory(newSessionId());
  enterDiscoveryFlow(memory);
  memory.setPendingAction({
    type: 'await_discovery_cart_handoff',
    summary: 'handoff',
    payload: { productName: 'Cement' }
  });
  const screen = resolveVoiceUiScreenForNavigate(memory, 'Added. Say continue.');
  assert.equal(screen?.path, '/cart');
});

test('pending await_select_supplier navigates to supplier page', () => {
  const memory = new SessionMemory(newSessionId());
  memory.setPendingAction({ type: 'await_select_supplier', summary: 'pick supplier' });
  const screen = resolveVoiceUiScreenForNavigate(memory, '');
  assert.equal(screen?.path, '/supplier-select');
});

test('quantity prompt maps to product discovery', () => {
  const screen = resolveVoiceUiScreenFromReply(promptAskQuantity('Cement'));
  assert.equal(screen?.path, '/product-discovery');
});

test('does not jump to discovery from stale last_search alone', () => {
  const memory = new SessionMemory(newSessionId());
  memory.setContext('last_search', { products: [{ id: '1', name: 'X' }] });
  const screen = resolveVoiceUiScreenForNavigate(memory, 'Thanks.');
  assert.equal(screen, null);
});
