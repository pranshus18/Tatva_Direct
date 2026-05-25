import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAddToCartUtterance } from '../voice/lib/addToCartParse.js';
import { parseQuantity, parseVoicePickQuantity } from '../voice/lib/spokenNumbers.js';
import { isAddToCartIntent } from '../voice/lib/voiceIntentPhrases.js';
import { isLikelyProductSearch } from '../voice/lib/productQueryParser.js';
import { SessionMemory, newSessionId } from '../voice/sessionMemory.js';
import { enterDiscoveryFlow } from '../voice/lib/voice_flow_mode.js';
import { tryAddToCartFlow, isAddToCartIntent as flowAddIntent } from '../voice/services/add_to_cart_flow.js';

test('parseAddToCartUtterance extracts quantity in roman Hindi', () => {
  const p = parseAddToCartUtterance('cart mein do jodo');
  assert.equal(p.quantity, 2);
  assert.ok(isAddToCartIntent('cart mein do jodo'));
});

test('parseAddToCartUtterance extracts Telugu quantity phrase', () => {
  assert.equal(parseQuantity('rendu'), 2);
  assert.equal(parseQuantity('రెండు'), 2);
  assert.ok(isAddToCartIntent('cart lo add cheyyandi'));
});

test('parseVoicePickQuantity treats stuttered "11" as quantity 1', () => {
  assert.equal(parseVoicePickQuantity('11'), 1);
  assert.equal(parseVoicePickQuantity('1 1'), 1);
  assert.equal(parseVoicePickQuantity('one one'), 1);
  assert.equal(parseQuantity('11'), 11);
});

test('add to cart phrases are not treated as ambient product search', () => {
  assert.equal(isLikelyProductSearch('cart mein jodo'), false);
  assert.equal(isLikelyProductSearch('कार्ट में जोड़ो'), false);
  assert.equal(isLikelyProductSearch('rendu'), false);
});

test('await_add_quantity accepts native number words', async () => {
  const memory = new SessionMemory(newSessionId());
  memory.setVoiceLanguage('hindi');
  memory.setVoiceLanguageSelected(true);
  enterDiscoveryFlow(memory);
  memory.setPendingAction({
    type: 'await_add_quantity',
    summary: 'add cement',
    payload: { id: 'prod-1', name: 'Cement' }
  });

  const toolCtx = {
    memory,
    client: {},
    token: 'test'
  };

  const mockExecute = async () => ({ ok: true, speech: 'added' });
  const orig = (await import('../voice/services/tool_calling_engine.js')).toolCallingEngine;
  const saved = orig.execute;
  orig.execute = mockExecute;

  try {
    const reply = await tryAddToCartFlow('do', toolCtx, memory);
    assert.ok(reply, 'should accept Hindi do as quantity');
    const pending = memory.getPendingAction();
    assert.ok(
      !pending || pending.type === 'await_discovery_cart_handoff',
      `expected cart handoff, got ${pending?.type}`
    );
  } finally {
    orig.execute = saved;
  }
});

test('isAddToCartIntent export matches flow', () => {
  assert.equal(flowAddIntent('jodo'), true);
});
