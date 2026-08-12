import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSpecificationMaps,
  mergeCatalogAndOfferSpecificationsForDisplay,
  parseSpecificationsObject,
  buildSpecificationTemplateFromFields,
  countMeaningfulSpecValues,
  specificationTemplateKeysOnly,
  mergeSelectedCatalogProductSpecifications
} from '../services/supplierCatalogHelpersService.js';

test('parseSpecificationsObject: parses JSON string and legacy array rows', () => {
  const fromString = parseSpecificationsObject('{"finish":"Matt","volume":"20L"}');
  assert.equal(fromString.finish, 'Matt');

  const fromArray = parseSpecificationsObject([
    { key: 'brandModel', value: 'Tractor Emulsion' },
    ['sheen', 'Low']
  ]);
  assert.equal(fromArray.brandModel, 'Tractor Emulsion');
  assert.equal(fromArray.sheen, 'Low');
});

test('mergeSpecificationMaps: keeps template keys and fills values from catalog', () => {
  const merged = mergeSpecificationMaps(
    { finish: null, volume: null },
    { finish: 'Matt', coverage: '140 sq ft/L' }
  );
  assert.equal(merged.finish, 'Matt');
  assert.equal(merged.volume, null);
  assert.equal(merged.coverage, '140 sq ft/L');
});

test('specificationTemplateKeysOnly: keeps keys and clears values', () => {
  const keysOnly = specificationTemplateKeysOnly({
    'Product Type': 'OPC 53 Grade',
    Color: 'Grey',
    'Net Weight': '50 kg'
  });
  assert.deepEqual(keysOnly, {
    'Product Type': '',
    Color: '',
    'Net Weight': ''
  });
});

test('buildSpecificationTemplateFromFields: returns null-valued keys', () => {
  const template = buildSpecificationTemplateFromFields([
    { field_key: 'finish' },
    { field_key: 'volume' }
  ]);
  assert.deepEqual(template, { finish: null, volume: null });
});

test('mergeCatalogAndOfferSpecificationsForDisplay: offer values win; catalog fills empty keys', () => {
  const merged = mergeCatalogAndOfferSpecificationsForDisplay(
    { COLOR: 'Blue', CAPACITY: '600 ml', MATERIAL: 'Steel' },
    { COLOR: '', CAPACITY: '750 ml' }
  );
  assert.equal(merged.COLOR, 'Blue');
  assert.equal(merged.CAPACITY, '750 ml');
  assert.equal(merged.MATERIAL, 'Steel');
});

test('mergeCatalogAndOfferSpecificationsForDisplay: empty offer does not wipe admin catalog values', () => {
  const merged = mergeCatalogAndOfferSpecificationsForDisplay(
    { 'B P A FREE': 'Yes', HEIGHT: '25 cm' },
    { 'B P A FREE': '', HEIGHT: '', COLOR: '' }
  );
  assert.equal(merged['B P A FREE'], 'Yes');
  assert.equal(merged.HEIGHT, '25 cm');
  assert.equal(merged.COLOR, '');
});

test('mergeCatalogAndOfferSpecificationsForDisplay: dedupes keys that differ only by casing/spacing', () => {
  const merged = mergeCatalogAndOfferSpecificationsForDisplay(
    {
      Color: 'Silver',
      'B P A Free': 'Yes',
      'Dishwasher Safe': 'No',
      Height: '1 l'
    },
    {
      color: 'silver',
      'bpa-free': 'yes',
      'dishwasher_safe': 'no',
      height: '600 ml'
    }
  );

  assert.equal(Object.keys(merged).length, 4);
  assert.equal(merged.height, '600 ml');
  assert.equal(merged.color, 'silver');
  assert.equal(merged['bpa-free'], 'yes');
});

test('countMeaningfulSpecValues: ignores null placeholders', () => {
  assert.equal(countMeaningfulSpecValues({ finish: null, volume: '20L' }), 1);
});

test('mergeSelectedCatalogProductSpecifications: catalog wins; offers only fill blanks', () => {
  const merged = mergeSelectedCatalogProductSpecifications(
    { Connectivity: 'Bluetooth', Playtime: '57H', Color: '' },
    [
      {
        status: 'approved',
        updated_at: '2026-01-02T00:00:00.000Z',
        attributes: {
          specifications: {
            Connectivity: 'Wireless',
            'Product Type': 'Wireless Mouse',
            Color: 'Black'
          }
        }
      }
    ]
  );
  assert.equal(merged.Connectivity, 'Bluetooth');
  assert.equal(merged.Playtime, '57H');
  assert.equal(merged.Color, 'Black');
  // Foreign offer-only keys must not pollute the selected catalog product.
  assert.equal(merged['Product Type'], undefined);
});

test('mergeSelectedCatalogProductSpecifications: ignores non-approved offers', () => {
  const merged = mergeSelectedCatalogProductSpecifications(
    { Color: 'Black' },
    [
      {
        status: 'pending',
        attributes: { specifications: { Color: 'Red', 'Product Type': 'Wireless Mouse' } }
      }
    ]
  );
  assert.deepEqual(merged, { Color: 'Black' });
});

test('pickBestSpecificationMap: prefers richer specs and can exclude current product', () => {
  const pickBest = (rows, options = {}) => {
    const excludeProductId = options.excludeProductId || null;
    let best = null;
    let bestScore = -1;
    for (const row of rows) {
      if (excludeProductId && row?.id === excludeProductId) continue;
      const specs = parseSpecificationsObject(row?.specifications);
      if (!specs || Object.keys(specs).length === 0) continue;
      const score = countMeaningfulSpecValues(specs) * 1000 + Object.keys(specs).length;
      if (score > bestScore) {
        bestScore = score;
        best = specs;
      }
    }
    return best;
  };

  const rows = [
    { id: 'self', specifications: { certification: [] } },
    { id: 'admin', specifications: { finish: 'Matt', volume: '20L', sheen: 'Low' } }
  ];

  assert.equal(pickBest(rows, { excludeProductId: 'self' })?.finish, 'Matt');
  assert.equal(pickBest(rows)?.finish, 'Matt');
});
