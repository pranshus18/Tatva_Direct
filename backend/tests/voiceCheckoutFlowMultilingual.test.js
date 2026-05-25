import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionMemory, newSessionId } from '../voice/sessionMemory.js';
import { enterDiscoveryFlow } from '../voice/lib/voice_flow_mode.js';
import { FLOW_STEPS } from '../voice/lib/voice_prompts.js';
import { resolveVoiceUiScreenForNavigate } from '../voice/lib/voice_ui_screens.js';
import {
  isAddToCartIntent,
  isCartContinuePhrase,
  isNoSubstitutionPhrase,
  isPlaceOrderPhrase,
  isSubstitutionAcceptPhrase
} from '../voice/lib/voiceIntentPhrases.js';
import { parseQuantity } from '../voice/lib/spokenNumbers.js';
import { parseRequiredDate } from '../voice/services/checkout/checkout_flow_state.js';

/** Expected voice checkout order (discovery path). */
const FLOW_ORDER = [
  { step: 'search', pending: 'await_pick_product', screen: '/product-discovery' },
  { step: 'quantity', pending: 'await_add_quantity', screen: '/product-discovery' },
  { step: 'cart', pending: 'await_discovery_cart_handoff', screen: '/cart' },
  { step: 'suppliers', pending: 'await_select_supplier', screen: '/supplier-select' },
  { step: 'substitution', pending: 'await_substitution', screen: '/substitution' },
  { step: 'po_details', pending: 'await_po_details', screen: '/create-po' },
  { step: 'transport', pending: 'await_transport', screen: '/transport-suggestion' },
  { step: 'confirm_order', pending: 'await_place_confirm', screen: '/create-po' }
];

const LANG_PHRASES = {
  english: {
    add: 'add to cart',
    qty: '2',
    continue: 'continue',
    noSub: 'no substitution',
    place: 'place the order'
  },
  hinglish: {
    add: 'cart mein add karo',
    qty: '2',
    continue: 'continue karo',
    noSub: 'substitution nahi chahiye',
    place: 'order place karo'
  },
  hindi: {
    add: 'cart mein jod do',
    qty: 'do',
    continue: 'aage badho',
    noSub: 'substitution nahi',
    place: 'order place karo'
  },
  kannada: {
    add: 'cart ge serisu',
    qty: 'eradu',
    continue: 'munduvarisu',
    noSub: 'substitution beda',
    place: 'order place maadi'
  },
  telugu: {
    add: 'cart lo add cheyyandi',
    qty: 'rendu',
    continue: 'munduku',
    noSub: 'substitution ledu',
    place: 'order place cheyyandi'
  }
};

test('FLOW_STEPS matches required checkout sequence labels', () => {
  const labels = FLOW_ORDER.map((s) => FLOW_STEPS[s.step].label);
  assert.deepEqual(labels, [
    'Product search',
    'Quantity',
    'Cart',
    'Supplier selection',
    'Substitution',
    'Purchase order details',
    'Transport selection',
    'Order confirmation'
  ]);
});

test('each pending step maps to the correct UI screen', () => {
  for (const { pending, screen } of FLOW_ORDER) {
    const memory = new SessionMemory(newSessionId());
    enterDiscoveryFlow(memory);
    memory.setPendingAction({ type: pending, summary: 'test', payload: {} });
    const resolved = resolveVoiceUiScreenForNavigate(memory, '');
    assert.equal(resolved?.path, screen, `${pending} → ${screen}`);
  }
});

for (const [lang, phrases] of Object.entries(LANG_PHRASES)) {
  test(`${lang}: discovery → cart → supplier → skip sub → place order phrases`, () => {
    assert.equal(isAddToCartIntent(phrases.add), true, 'add to cart');
    assert.equal(parseQuantity(phrases.qty), 2, 'quantity');
    assert.equal(isCartContinuePhrase(phrases.continue), true, 'continue to supplier');
    assert.equal(isNoSubstitutionPhrase(phrases.noSub), true, 'skip substitution');
    assert.equal(isPlaceOrderPhrase(phrases.place), true, 'place order');
  });
}

test('hindi kannada telugu can accept substitution when offered', () => {
  assert.equal(isSubstitutionAcceptPhrase('haan'), true);
  assert.equal(isSubstitutionAcceptPhrase('howdu'), true);
  assert.equal(isSubstitutionAcceptPhrase('avunu'), true);
});

test('multilingual tomorrow for PO delivery date', () => {
  assert.ok(parseRequiredDate('kal'));
  assert.ok(parseRequiredDate('naale'));
  assert.ok(parseRequiredDate('repu'));
});
