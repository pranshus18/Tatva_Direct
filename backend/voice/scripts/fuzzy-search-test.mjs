import { expandSearchQueries } from '../lib/fuzzySearchQueries.js';
import {
  rankProductsByQuery,
  filterByFuzzyScore,
  shouldRunFuzzyFallback
} from '../../services/productDiscoveryFuzzyRank.js';

const variants = expandSearchQueries('mak air m2');
if (!variants.includes('mac air m2') && !variants.some((v) => v.includes('mac'))) {
  console.error('expandSearchQueries(mak air m2) missing mac variant:', variants);
  process.exit(1);
}

const pool = [
  { id: '1', name: 'Mac Air M2', brand: 'Apple', description: 'laptop' },
  { id: '2', name: 'Portland Cement 50kg', brand: 'UltraTech', description: '' },
  { id: '3', name: 'TMT Steel Rod 12mm', brand: '', description: 'construction steel' }
];

const ranked = rankProductsByQuery('simant', pool);
const cement = ranked.find((p) => p.name.includes('Cement'));
if (!cement || cement.matchScore < 0.32) {
  console.error('fuzzy rank simant→cement failed', ranked);
  process.exit(1);
}

const makAir = rankProductsByQuery('mak air', pool)[0];
if (!makAir?.name?.includes('Mac')) {
  console.error('fuzzy rank mak air failed', rankProductsByQuery('mak air', pool));
  process.exit(1);
}

if (!shouldRunFuzzyFallback('mak buk', [], 5)) {
  console.error('shouldRunFuzzyFallback expected true for empty');
  process.exit(1);
}

const hits = filterByFuzzyScore(rankProductsByQuery('stil rod', pool));
if (!hits.some((p) => /steel|rod/i.test(p.name))) {
  console.error('filter stil rod failed', hits);
  process.exit(1);
}

console.log('fuzzy-search-test: ok');
