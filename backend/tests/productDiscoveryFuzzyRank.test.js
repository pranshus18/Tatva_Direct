import test from 'node:test';
import assert from 'node:assert/strict';
import { rankProductsByQuery } from '../services/productDiscoveryFuzzyRank.js';

test('rankProductsByQuery matches products by category label', () => {
  const products = [
    { id: '1', name: 'HP Pavilion 15', category: 'Laptops', description: 'Business notebook' },
    { id: '2', name: 'Portland Cement', category: 'Construction', description: 'OPC 53 grade' }
  ];

  const ranked = rankProductsByQuery('laptop', products);
  assert.equal(ranked[0]?.id, '1');
  assert.ok((ranked[0]?.matchScore || 0) > 0.3);
});

test('rankProductsByQuery keeps stronger name matches ahead of weak category matches', () => {
  const products = [
    { id: '1', name: 'Gaming Laptop Pro', category: 'Electronics', description: '' },
    { id: '2', name: 'Office Chair', category: 'Laptop Accessories', description: '' }
  ];

  const ranked = rankProductsByQuery('laptop', products);
  assert.equal(ranked[0]?.id, '1');
});
