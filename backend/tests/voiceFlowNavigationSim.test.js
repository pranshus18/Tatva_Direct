/**
 * Simulates checkout state transitions and asserts UI navigation targets
 * (no live API — verifies routing logic used after each voice turn).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionMemory, newSessionId } from '../voice/sessionMemory.js';
import { enterDiscoveryFlow } from '../voice/lib/voice_flow_mode.js';
import { resolveVoiceUiScreenForNavigate } from '../voice/lib/voice_ui_screens.js';
import {
  promptAskQuantity,
  promptDiscoveryCartHandoff,
  promptSuppliers,
  promptSubstitutions,
  promptPoRequiredDate,
  promptTransportOptions
} from '../voice/lib/voice_prompts.js';
import { voiceScreenToPayload } from '../voice/lib/voice_ui_screens.js';

const FLOW_SEQUENCE = [
  {
    label: 'pick product',
    setup(memory) {
      enterDiscoveryFlow(memory);
      memory.setPendingAction({
        type: 'await_pick_product',
        summary: 'pick',
        payload: { products: [{ id: '1', name: 'Cement' }] }
      });
    },
    expectedPath: '/product-discovery'
  },
  {
    label: 'quantity',
    setup(memory) {
      memory.setPendingAction({
        type: 'await_add_quantity',
        summary: 'qty',
        payload: { id: '1', name: 'Cement' }
      });
    },
    reply: () => promptAskQuantity('Cement'),
    expectedPath: '/product-discovery'
  },
  {
    label: 'cart handoff',
    setup(memory) {
      memory.setContext('checkout', { items: [{ id: '1', name: 'Cement', qty: 2 }] });
      memory.setPendingAction({
        type: 'await_discovery_cart_handoff',
        summary: 'handoff',
        payload: { productName: 'Cement' }
      });
    },
    reply: () => promptDiscoveryCartHandoff(),
    expectedPath: '/cart'
  },
  {
    label: 'supplier',
    setup(memory) {
      memory.setContext('checkout', {
        items: [{ id: '1', name: 'Cement' }],
        itemVendors: { '1': [] },
        selectedVendors: {}
      });
      memory.setPendingAction({
        type: 'await_select_supplier',
        summary: 'supplier',
        payload: { itemId: '1', vendors: [{ name: 'Vendor A' }] }
      });
    },
    reply: (memory) =>
      promptSuppliers(1, ['1. Vendor A — 100 rupees'], memory),
    expectedPath: '/supplier-select'
  },
  {
    label: 'substitution',
    setup(memory) {
      memory.setContext('checkout', {
        items: [{ id: '1' }],
        selectedVendors: { '1': 'v1' },
        substitutionSuggestions: [{ title: 'Alt cement' }]
      });
      memory.setPendingAction({
        type: 'await_substitution',
        summary: 'sub',
        payload: { suggestions: [{ title: 'Alt' }] }
      });
    },
    reply: (memory) =>
      promptSubstitutions('Vendor A', 1, ['1. Alt cement'], null, memory),
    expectedPath: '/substitution'
  },
  {
    label: 'PO details',
    setup(memory) {
      memory.setContext('checkout', {
        items: [{ id: '1' }],
        poFieldsQueue: ['requiredDate', 'paymentMethod', 'confirmAddresses'],
        poFieldIndex: 0
      });
      memory.setPendingAction({
        type: 'await_po_details',
        summary: 'po',
        payload: { field: 'requiredDate' }
      });
    },
    reply: (memory) => promptPoRequiredDate(memory),
    expectedPath: '/create-po'
  },
  {
    label: 'transport',
    setup(memory) {
      memory.setContext('checkout', {
        poGroups: [{ vendorName: 'V', total: 1000 }],
        optionsByVendor: { v1: { providers: [{ name: 'BlueDart', rate: 50 }] } }
      });
      memory.setPendingAction({
        type: 'await_transport',
        summary: 'transport',
        payload: { quotesLoaded: true }
      });
    },
    reply: (memory) => promptTransportOptions(['Vendor A: 1. BlueDart 50 rupees'], memory),
    expectedPath: '/transport-suggestion'
  },
  {
    label: 'place confirm',
    setup(memory) {
      memory.setContext('checkout', {
        poGroups: [{ total: 1000 }],
        transportByVendor: { v1: 'BlueDart' }
      });
      memory.setPendingAction({ type: 'await_place_confirm', summary: 'confirm', payload: {} });
    },
    expectedPath: '/create-po'
  }
];

test('full checkout sequence resolves correct page per step', () => {
  const memory = new SessionMemory(newSessionId());
  for (const step of FLOW_SEQUENCE) {
    step.setup(memory);
    const replyText = step.reply ? step.reply(memory) : '';
    const screen = resolveVoiceUiScreenForNavigate(memory, replyText);
    const payload = voiceScreenToPayload(screen);
    assert.equal(
      payload?.path?.split('?')[0],
      step.expectedPath,
      `${step.label}: expected ${step.expectedPath}, got ${payload?.path}`
    );
  }
});

test('hindi reply uses localized step label and still navigates to cart', () => {
  const memory = new SessionMemory(newSessionId());
  memory.setVoiceLanguage('hindi');
  memory.setPendingAction({
    type: 'await_discovery_cart_handoff',
    summary: 'handoff',
    payload: {}
  });
  const reply = promptDiscoveryCartHandoff(memory);
  assert.match(reply, /चरण\s*3|कार्ट/i);
  assert.equal(resolveVoiceUiScreenForNavigate(memory, reply)?.path, '/cart');
});
