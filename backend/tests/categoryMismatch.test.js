import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCategoryMismatch,
  expandCategoryMatchTokens,
  singularPluralForms,
  textContainsMatchToken
} from '../utils/categoryMismatch.js';

test('singularPluralForms: printers <-> printer', () => {
  assert.ok(singularPluralForms('printers').includes('printer'));
  assert.ok(singularPluralForms('printer').includes('printers'));
});

test('expandCategoryMatchTokens includes printer aliases for printers', () => {
  const tokens = expandCategoryMatchTokens('printers');
  assert.ok(tokens.includes('printer'));
  assert.ok(tokens.includes('printers'));
  assert.ok(tokens.includes('laserjet') || tokens.includes('mfp'));
});

test('textContainsMatchToken matches whole words', () => {
  assert.equal(textContainsMatchToken('laser printer designed for office use', 'printer'), true);
  assert.equal(textContainsMatchToken('printing press', 'printer'), false);
});

test('detectCategoryMismatch: printers + laser printer description is consistent', () => {
  const warning = detectCategoryMismatch(
    'printers',
    'HP LaserJet Pro MFP 4104dw is a multifunction monochrome laser printer designed for office use. Supports printing, scanning and copying with automatic duplex printing and network connectivity.',
    'HP LaserJet Pro MFP 4104dw Printer'
  );
  assert.equal(warning, null);
});

test('detectCategoryMismatch: printers matches description with singular printer only', () => {
  const warning = detectCategoryMismatch(
    'printers',
    'A compact monochrome laser printer for small offices.'
  );
  assert.equal(warning, null);
});

test('detectCategoryMismatch: product name alone can establish consistency', () => {
  const warning = detectCategoryMismatch(
    'printers',
    'Supports automatic duplex and network connectivity for office workflows.',
    'HP LaserJet Pro MFP 4104dw Printer'
  );
  assert.equal(warning, null);
});

test('detectCategoryMismatch: clear cross-category conflict still warns', () => {
  const warning = detectCategoryMismatch(
    'cement',
    'Premium emulsion paint with matt sheen for interior walls.'
  );
  assert.ok(warning);
  assert.match(warning, /does not match/i);
});

test('detectCategoryMismatch: no competing signal does not soft-warn', () => {
  const warning = detectCategoryMismatch(
    'specialty coatings',
    'High durability finish for exterior industrial surfaces.'
  );
  assert.equal(warning, null);
});
