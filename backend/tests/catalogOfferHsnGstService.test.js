import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickCanonicalHsnAndGstFromOffers,
  emptyCanonicalHsnGst
} from '../services/catalogOfferHsnGstService.js';

const catalogWcSpecs = { Color: 'White', Series: 'Continental' };

test('pickCanonicalHsnAndGstFromOffers copies HSN and GST from an existing offer', () => {
  const picked = pickCanonicalHsnAndGstFromOffers(
    [
      {
        variant_key: 'TSPCYY1JI',
        status: 'approved',
        is_active: true,
        igst_rate: 18,
        cgst_rate: 9,
        sgst_rate: 9,
        attributes: { hsnCode: '6910', specifications: catalogWcSpecs }
      }
    ],
    { variantKey: 'computed-new-key', specifications: catalogWcSpecs, catalogSpecs: catalogWcSpecs }
  );
  assert.equal(picked.hsnCode, '6910');
  assert.equal(picked.igstRate, 18);
  assert.equal(picked.cgstRate, 9);
  assert.equal(picked.sgstRate, 9);
});

test('pickCanonicalHsnAndGstFromOffers reuses unique product HSN/GST when variant keys differ', () => {
  const picked = pickCanonicalHsnAndGstFromOffers(
    [
      {
        variant_key: 'TSPCYY1YL',
        status: 'pending',
        igst_rate: null,
        attributes: { specifications: {} }
      },
      {
        variant_key: 'TSPCYY1JI',
        status: 'approved',
        is_active: true,
        igst_rate: 18,
        cgst_rate: 9,
        sgst_rate: 9,
        attributes: { hsnCode: '6910', specifications: {} }
      }
    ],
    { variantKey: 'brand-new' }
  );
  assert.equal(picked.hsnCode, '6910');
  assert.equal(picked.igstRate, 18);
});

test('pickCanonicalHsnAndGstFromOffers does not mix HSN/GST across different catalog variants', () => {
  const picked = pickCanonicalHsnAndGstFromOffers(
    [
      {
        variant_key: 'white',
        status: 'approved',
        is_active: true,
        igst_rate: 18,
        cgst_rate: 9,
        sgst_rate: 9,
        attributes: { hsnCode: '6910', specifications: { Color: 'White' } }
      },
      {
        variant_key: 'black',
        status: 'approved',
        is_active: true,
        igst_rate: 12,
        cgst_rate: 6,
        sgst_rate: 6,
        attributes: { hsnCode: '7324', specifications: { Color: 'Black' } }
      }
    ],
    {
      variantKey: 'white',
      specifications: { Color: 'White' },
      catalogSpecs: { Color: 'White' }
    }
  );
  assert.equal(picked.hsnCode, '6910');
  assert.equal(picked.igstRate, 18);
});

test('pickCanonicalHsnAndGstFromOffers leaves HSN/GST empty when variants disagree', () => {
  const picked = pickCanonicalHsnAndGstFromOffers(
    [
      {
        variant_key: 'white',
        status: 'approved',
        is_active: true,
        igst_rate: 18,
        cgst_rate: 9,
        sgst_rate: 9,
        attributes: { hsnCode: '6910', specifications: { Color: 'White' } }
      },
      {
        variant_key: 'black',
        status: 'approved',
        is_active: true,
        igst_rate: 12,
        cgst_rate: 6,
        sgst_rate: 6,
        attributes: { hsnCode: '7324', specifications: { Color: 'Black' } }
      }
    ],
    { variantKey: 'brand-new', specifications: { Color: 'Green' }, catalogSpecs: {} }
  );
  assert.equal(picked.hsnCode, null);
  assert.equal(picked.igstRate, null);
});

test('pickCanonicalHsnAndGstFromOffers ignores rejected offers and empty results', () => {
  assert.deepEqual(
    pickCanonicalHsnAndGstFromOffers([
      {
        status: 'rejected',
        igst_rate: 18,
        cgst_rate: 9,
        sgst_rate: 9,
        attributes: { hsnCode: '6910' }
      }
    ]),
    emptyCanonicalHsnGst()
  );
  assert.deepEqual(pickCanonicalHsnAndGstFromOffers([]), emptyCanonicalHsnGst());
});
