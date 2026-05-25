import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionMemory, newSessionId } from '../voice/sessionMemory.js';
import { setCheckout } from '../voice/services/checkout/checkout_flow_state.js';
import { syncVoiceCheckoutToCart } from '../voice/services/checkout/checkout_flow_sync.js';

test('syncVoiceCheckoutToCart PUTs selectedVendors to PO cart', async () => {
  const memory = new SessionMemory(newSessionId());
  const puts = [];
  const toolCtx = {
    client: {
      async get(path) {
        if (path === '/api/po/cart') {
          return {
            ok: true,
            data: {
              cart: {
                draft: {
                  boqGroups: [
                    {
                      groupId: 'g1',
                      items: [{ id: 'line-1', productId: 'p1', name: 'Mac Air M2', quantity: 2 }]
                    }
                  ],
                  selectedVendors: {}
                }
              }
            }
          };
        }
        return { ok: false };
      },
      async put(path, body) {
        puts.push({ path, body });
        return { ok: true, data: {} };
      }
    },
    memory
  };

  setCheckout(memory, {
    items: [{ id: 'line-1', productId: 'p1', name: 'Mac Air M2', quantity: 2 }],
    selectedVendors: { 'line-1': 'supplier-token-99', p1: 'supplier-token-99' }
  });

  const result = await syncVoiceCheckoutToCart(toolCtx, memory);
  assert.equal(result.ok, true);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].path, '/api/po/cart');
  assert.equal(puts[0].body.selectedVendors['line-1'], 'supplier-token-99');
});
