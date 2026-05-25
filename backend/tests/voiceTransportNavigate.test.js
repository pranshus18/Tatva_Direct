import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionMemory, newSessionId } from '../voice/sessionMemory.js';
import { setCheckout } from '../voice/services/checkout/checkout_flow_state.js';
import { resolveVoiceUiScreenForNavigate, buildVoiceNavigatePayload } from '../voice/lib/voice_ui_screens.js';
import { isTransportDonePhrase } from '../voice/lib/voiceIntentPhrases.js';
import { hasMandatoryTransportSelected } from '../voice/lib/transportGate.js';

test('resolveVoiceUiScreenForNavigate goes to create_po when transport already selected', () => {
  const memory = new SessionMemory(newSessionId());
  memory.setPendingAction({ type: 'await_transport', summary: 'transport', payload: {} });
  setCheckout(memory, {
    poGroups: [{ vendorId: 'v1', vendorName: 'Acme', total: 1000, items: [] }],
    optionsByVendor: {
      v1: { vendorName: 'Acme', providers: [{ name: 'BlueDart', rate: 120 }] }
    },
    transportByVendor: { v1: 'BlueDart' },
    transportDetailByVendor: { v1: { name: 'BlueDart', rate: 120 } }
  });

  assert.equal(hasMandatoryTransportSelected(memory.getContext('checkout', {})), true);
  const screen = resolveVoiceUiScreenForNavigate(memory, '');
  assert.equal(screen?.path, '/create-po');
});

test('buildVoiceNavigatePayload includes transportSelection for create_po', () => {
  const memory = new SessionMemory(newSessionId());
  setCheckout(memory, {
    poGroups: [{ vendorId: 'v1', vendorName: 'Acme', total: 500, items: [] }],
    grandTotal: 500,
    requiredDate: '2026-06-01',
    transportByVendor: { v1: 'Delhivery' },
    transportDetailByVendor: { v1: { name: 'Delhivery', rate: 80 } }
  });

  const payload = buildVoiceNavigatePayload(
    { path: '/create-po', query: '?voice=1', label: 'Create purchase order' },
    memory
  );
  assert.equal(payload.screen, 'create_po');
  assert.equal(payload.transportSelection?.byVendorId?.v1, 'Delhivery');
  assert.equal(payload.poGroups?.length, 1);
});

test('isTransportDonePhrase recognizes done and continue', () => {
  assert.equal(isTransportDonePhrase('done'), true);
  assert.equal(isTransportDonePhrase('continue'), true);
  assert.equal(isTransportDonePhrase('transport done'), true);
  assert.equal(isTransportDonePhrase('number 2'), false);
});
