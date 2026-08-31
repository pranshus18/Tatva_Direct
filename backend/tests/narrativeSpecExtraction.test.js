import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSpecsFromNarrativeDescription,
  mapSpecsOntoTemplateKeys
} from '../utils/narrativeSpecExtraction.js';

test('maps extracted keys onto admin template keys ignoring case and aliases', () => {
  const { mapped, extras } = mapSpecsOntoTemplateKeys(
    { colour: 'White', netWeight: '17.5 kg', material: 'Vitreous China' },
    ['COLOR', 'WEIGHT', 'SERIES']
  );
  assert.equal(mapped.COLOR, 'White');
  assert.equal(mapped.WEIGHT, '17.5 kg');
  assert.equal(mapped.SERIES, undefined);
  assert.equal(extras.material, 'Vitreous China');
});

test('extracts specs from marketing prose without key:value lines', () => {
  const description =
    'The Jaquar Continental wall hung basin is made of vitreous china in white, ' +
    'where bacteria and grime typically accumulate, and is specifically sized to suit smaller bathrooms. Net weight 17.5 kg.';
  const specs = extractSpecsFromNarrativeDescription({
    description,
    productName: 'Jaquar Continental Wall Hung Basin',
    templateKeys: ['BRAND', 'COLOR', 'SERIES', 'WEIGHT']
  });

  assert.equal(specs.BRAND, 'Jaquar');
  assert.equal(specs.COLOR, 'White');
  assert.equal(specs.SERIES, 'Continental');
  assert.equal(specs.WEIGHT, '17.5 kg');
  assert.equal(specs.Material, 'Vitreous China');
});

test('extracts finish and capacity from paint-style prose', () => {
  const specs = extractSpecsFromNarrativeDescription({
    description: 'Matt finish 20L emulsion covering 140 sq ft per litre.',
    templateKeys: ['FINISH', 'VOLUME']
  });
  assert.equal(specs.FINISH, 'Matt');
  assert.equal(specs.VOLUME, '20 L');
});

test('returns nothing useful from marketing copy with no product facts', () => {
  const specs = extractSpecsFromNarrativeDescription({
    description: 'A wonderful addition to any space. Shop now for quality you can trust.',
    productName: '',
    templateKeys: ['BRAND', 'COLOR', 'WEIGHT']
  });
  assert.equal(Object.keys(specs).length, 0);
});

test('still reads explicit key:value lines when present', () => {
  const specs = extractSpecsFromNarrativeDescription({
    description: 'Finish: Matt\nVolume: 20L\nSheen: Low',
    templateKeys: ['FINISH', 'VOLUME']
  });
  assert.equal(specs.FINISH, 'Matt');
  assert.equal(specs.VOLUME, '20L');
  assert.equal(specs.Sheen, 'Low');
});
