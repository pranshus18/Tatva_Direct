import test from 'node:test';
import assert from 'node:assert/strict';
import { sortDiscoverySuggestions } from '../services/productDiscoverySearchService.js';

test('sortDiscoverySuggestions uses stable alphabetical order when not searching', () => {
  const sorted = sortDiscoverySuggestions(
    [
      { id: 'b-id', name: 'Mac Air M2', matchScore: 0, recommendationScore: 5 },
      { id: 'a-id', name: 'Mac Air M1', matchScore: 0, recommendationScore: 0 },
      { id: 'c-id', name: 'HP Pavilion', matchScore: 0, recommendationScore: 10 }
    ],
    { query: '' }
  );

  assert.deepEqual(sorted.map((p) => p.name), ['HP Pavilion', 'Mac Air M1', 'Mac Air M2']);
});

test('sortDiscoverySuggestions prefers match score when searching', () => {
  const sorted = sortDiscoverySuggestions(
    [
      { id: '1', name: 'Zebra Cable', matchScore: 0.2 },
      { id: '2', name: 'Apple Charger', matchScore: 0.9 }
    ],
    { query: 'apple charger' }
  );

  assert.equal(sorted[0].id, '2');
});
