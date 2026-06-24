import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUpstreamOfferMatchType,
  isExactUpstreamVariantMatch,
  upstreamOffersMatchForSupplyChain
} from '../services/upstreamOfferMatchService.js';

test('upstreamOffersMatchForSupplyChain: same catalog product with different variant keys', () => {
  const mine = {
    product_id: 'dd7f1e85-5533-4c35-9344-c570fcffe8f1',
    variant_key: '2222f14ea08b1fbe997cd14ff462ef792b095ddace6ea4f5c4943af6e82de9db',
    variant_asin: 'TSLL2P'
  };
  const prans = {
    product_id: 'dd7f1e85-5533-4c35-9344-c570fcffe8f1',
    variant_key: 'e50698e1d690b2b1091a5c240fea4a2241f1c4eacd04338e7accead6fd3bb2e3',
    variant_asin: 'TSLL7G'
  };

  assert.equal(isExactUpstreamVariantMatch(mine, prans), false);
  assert.equal(getUpstreamOfferMatchType(mine, prans), 'catalog_product');
  assert.equal(upstreamOffersMatchForSupplyChain(mine, prans), true);
});

test('upstreamOffersMatchForSupplyChain: exact variant still preferred type', () => {
  const mine = {
    product_id: 'p1',
    variant_key: 'vk1',
    variant_asin: 'A1'
  };
  const upstream = { product_id: 'p1', variant_key: 'vk1', variant_asin: 'A2' };
  assert.equal(getUpstreamOfferMatchType(mine, upstream), 'exact_variant');
});
