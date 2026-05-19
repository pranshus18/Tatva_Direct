/**
 * Unit tests for voice step routing (no API / login required).
 * Run: node voice/scripts/voice-steps-unit-test.mjs
 */
import { isLikelyProductSearch } from '../lib/productQueryParser.js';
import {
  parseQuantity,
  parseSelectionIndex,
  isQuantityOnlyUtterance,
  isExplicitCancel
} from '../lib/spokenNumbers.js';
import {
  promptSearchSingle,
  promptAskQuantity,
  promptCartContinue,
  promptSuppliers,
  helpForPending
} from '../lib/voice_prompts.js';
import { resolveVoiceUiScreenFromReply } from '../lib/voice_ui_screens.js';
import { isAddToCartIntent } from '../services/add_to_cart_flow.js';
import {
  parseGoToScreenIntent,
  isResumeCheckoutPhrase,
  isCartContinuePhrase
} from '../services/voice_navigation_phrases.js';
import {
  enterCartCheckoutFlow,
  enterDiscoveryFlow,
  normalizePendingForFlow,
} from '../lib/voice_flow_mode.js';
import { SessionMemory } from '../sessionMemory.js';

let failed = 0;

function assert(label, condition) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}

assert('search single does not ask quantity in step 1', () => {
  const s = promptSearchSingle('Mac Air');
  return /Step 1/i.test(s) && !/Step 2,\s*Quantity/i.test(s);
});

assert('quantity prompt is step 2 only', () => {
  const q = promptAskQuantity('Mac Air');
  return /Step 2,\s*Quantity/i.test(q) && /How many Mac Air/i.test(q);
});

assert('bare "2" is not a product search', () => !isLikelyProductSearch('2'));
assert('"two" is not a product search', () => !isLikelyProductSearch('two'));
assert('"mac air" is a product search', () => isLikelyProductSearch('mac air'));
assert('"cement" is a product search', () => isLikelyProductSearch('cement'));

assert('isQuantityOnly: two', () => isQuantityOnlyUtterance('two'));
assert('isQuantityOnly: not number 2', () => !isQuantityOnlyUtterance('number 2'));

assert('pick index from "2" when max 5', () => parseSelectionIndex('2', 5) === 1);
assert('qty from "two"', () => parseQuantity('two') === 2);

assert('pick help is step 1 search', () => {
  const h = helpForPending('await_pick_product');
  return /Step 1/i.test(h) && !/then say how many/i.test(h);
});

assert('cart continue maps to cart screen', () => {
  const h = helpForPending('await_cart_continue');
  return /Step 3,\s*Cart/i.test(h);
});

assert('reply parse: quantity → discovery', () => {
  const s = resolveVoiceUiScreenFromReply(promptAskQuantity('Mac Air'));
  return s?.path === '/product-discovery';
});

assert('reply parse: cart → cart page', () => {
  const s = resolveVoiceUiScreenFromReply(promptCartContinue());
  return s?.path === '/cart';
});

assert('reply parse: supplier → supplier select', () => {
  const s = resolveVoiceUiScreenFromReply(
    promptSuppliers(2, ['Supplier 1, Acme.', 'Supplier 2, Beta.'])
  );
  return s?.path === '/supplier-select';
});

assert('combined reply uses last step (cart wins over add message)', () => {
  const s = resolveVoiceUiScreenFromReply(`Added Mac Air. ${promptCartContinue()}`);
  return s?.path === '/cart';
});

assert('add to cart intent', () => isAddToCartIntent('add to cart'));

assert('go to cart intent', () => parseGoToScreenIntent('go to my cart') === 'cart');
assert('resume checkout intent', () => isResumeCheckoutPhrase('continue checkout from cart'));
assert('bare continue is not cart checkout resume', () => !isResumeCheckoutPhrase('continue'));
assert('bare continue is cart continue phrase', () => isCartContinuePhrase('continue'));

assert('cart mode rejects discovery pending', () => {
  const m = new SessionMemory('test-flow');
  enterCartCheckoutFlow(m);
  const out = normalizePendingForFlow(m, { type: 'await_pick_product', payload: {} });
  return out === null && m.getPendingAction() === null;
});

assert('discovery mode rejects cart-only pending', () => {
  const m = new SessionMemory('test-flow-2');
  enterDiscoveryFlow(m);
  const out = normalizePendingForFlow(m, { type: 'await_cart_continue', payload: {} });
  return out === null;
});

assert('cancel during quantity needs explicit cancel', () =>
  isExplicitCancel('cancel', { pendingType: 'await_add_quantity' })
);

assert('no is not cancel during supplier pick', () =>
  !isExplicitCancel('no', { pendingType: 'await_select_supplier' })
);

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('voice-steps-unit-test: ok');
