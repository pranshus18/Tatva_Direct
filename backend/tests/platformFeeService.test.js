import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateLinePlatformFee,
  calculateOrderPlatformFeeFromContext,
  orderHasPlatformFeeSnapshot,
  pickFeeRuleForBrand,
  resolveLineAmount,
  resolveLineBrandName,
  resolveStoredOrComputedPlatformFee
} from '../services/platformFeeService.js';

const acmeDealerRule = {
  id: 'rule-acme-dealer',
  brand_name: 'Acme',
  normalized_brand: 'acme',
  supply_chain_role: 'dealer',
  fee_type: 'percentage',
  fee_value: 5,
  is_active: true
};

const havellsDealerRule = {
  id: 'rule-havells-dealer',
  brand_name: 'Havells Electrical',
  normalized_brand: 'havells electrical',
  supply_chain_role: 'dealer',
  fee_type: 'percentage',
  fee_value: 3.5,
  is_active: true
};

const otherDealerRule = {
  id: 'rule-other-dealer',
  brand_name: 'Berger',
  normalized_brand: 'berger',
  supply_chain_role: 'dealer',
  fee_type: 'percentage',
  fee_value: 2,
  is_active: true
};

const acmeFixedRule = {
  id: 'rule-acme-fixed',
  brand_name: 'Acme',
  normalized_brand: 'acme',
  supply_chain_role: 'dealer',
  fee_type: 'fixed',
  fee_value: 50,
  is_active: true
};

const dealerProfile = {
  companyInfoEntries: [
    { role: 'dealer', brands: 'Acme, Havells Electrical, Berger' }
  ]
};

test('resolveLineBrandName uses catalog product brand for every variant of that brand', () => {
  assert.equal(
    resolveLineBrandName({
      product: { brand: 'Acme' },
      productVariant: { brand: 'Acme' },
      supplierProduct: { attributes: { brandModel: 'Acme Widget XL' } }
    }),
    'Acme'
  );
});

test('resolveLineBrandName falls back to variant then offer brand when catalog brand is blank', () => {
  assert.equal(
    resolveLineBrandName({
      product: { brand: '' },
      productVariant: { brand: 'Acme' }
    }),
    'Acme'
  );
  assert.equal(
    resolveLineBrandName({
      product: { brand: null },
      specifications: JSON.stringify({ brandModel: 'Havells' })
    }),
    'Havells'
  );
});

test('resolveLineAmount prefers GST-inclusive line total so the set % is of what the buyer pays', () => {
  assert.equal(
    resolveLineAmount({
      total_price: 1000,
      specifications: { gst: { totalAmount: 1180 } }
    }),
    1180
  );
  assert.equal(resolveLineAmount({ unit_price: 200, quantity: 3 }), 600);
});

test('pickFeeRuleForBrand uses the exact admin brand row and the configured value', () => {
  const picked = pickFeeRuleForBrand(
    [acmeDealerRule, havellsDealerRule, { ...acmeDealerRule, brand_name: 'Acme Extra', normalized_brand: 'acme extra', fee_value: 9 }],
    'Acme'
  );
  assert.equal(picked.id, 'rule-acme-dealer');
  assert.equal(picked.fee_value, 5);
});

test('pickFeeRuleForBrand matches supply-chain prefix so Havells products use Havells Electrical admin fee', () => {
  const picked = pickFeeRuleForBrand([havellsDealerRule, acmeDealerRule], 'Havells');
  assert.equal(picked.id, 'rule-havells-dealer');
  assert.equal(picked.fee_value, 3.5);
});

test('pickFeeRuleForBrand does not apply a different brand spelling', () => {
  assert.equal(pickFeeRuleForBrand([acmeDealerRule], 'Akme'), null);
  assert.equal(pickFeeRuleForBrand([{ ...acmeDealerRule, brand_name: 'Philips', normalized_brand: 'philips' }], 'Phillips'), null);
});

test('calculateLinePlatformFee uses the exact percentage set in admin', () => {
  assert.equal(calculateLinePlatformFee({ lineAmount: 10000, feeRule: acmeDealerRule }), 500);
  assert.equal(calculateLinePlatformFee({ lineAmount: 199.99, feeRule: acmeDealerRule }), 10);
});

test('calculateLinePlatformFee uses the exact fixed INR set in admin and never exceeds the line', () => {
  assert.equal(calculateLinePlatformFee({ lineAmount: 10000, feeRule: acmeFixedRule }), 50);
  assert.equal(calculateLinePlatformFee({ lineAmount: 20, feeRule: acmeFixedRule }), 20);
});

test('brand percentage fee is deducted from every product and variant line under that brand', () => {
  const result = calculateOrderPlatformFeeFromContext({
    supplierProfile: dealerProfile,
    feeRules: [acmeDealerRule, otherDealerRule],
    orderItems: [
      { id: 'p1', product: { brand: 'Acme' }, total_price: 1000 },
      { id: 'v1', product: { brand: 'Acme' }, productVariant: { brand: 'Acme' }, total_price: 2000 },
      { id: 'v2', product: { brand: 'acme' }, supplierProduct: { attributes: { brand: 'Acme' } }, total_price: 500 },
      { id: 'other', product: { brand: 'Berger' }, total_price: 4000 }
    ]
  });

  assert.equal(result.feeAmount, 255);
  assert.equal(result.breakdown.length, 4);
  assert.deepEqual(
    result.breakdown.map((row) => row.feeAmount),
    [50, 100, 25, 80]
  );
  assert.deepEqual(
    result.breakdown.map((row) => row.feeValue),
    [5, 5, 5, 2]
  );
  assert.ok(result.breakdown.slice(0, 3).every((row) => row.ruleId === 'rule-acme-dealer'));
});

test('fixed brand fee is applied to each product and variant line at the saved INR amount', () => {
  const result = calculateOrderPlatformFeeFromContext({
    supplierProfile: dealerProfile,
    feeRules: [acmeFixedRule],
    orderItems: [
      { id: 'p1', product: { brand: 'Acme' }, total_price: 1000 },
      { id: 'v1', product: { brand: 'Acme' }, total_price: 2500 }
    ]
  });

  assert.equal(result.feeAmount, 100);
  assert.deepEqual(
    result.breakdown.map((row) => row.feeAmount),
    [50, 50]
  );
});

test('placement snapshot is reused at payment so a later admin edit does not change the deducted amount', () => {
  const placedOrder = {
    platform_fee_amount: 175,
    platform_fee_breakdown: [
      { brand: 'Acme', feeAmount: 50 },
      { brand: 'Acme', feeAmount: 100 },
      { brand: 'Acme', feeAmount: 25 }
    ]
  };
  assert.equal(orderHasPlatformFeeSnapshot(placedOrder), true);
  assert.equal(
    resolveStoredOrComputedPlatformFee({
      order: placedOrder,
      feeResult: { feeAmount: 999 },
      capAmount: 3500
    }),
    175
  );
  assert.equal(orderHasPlatformFeeSnapshot({ platform_fee_amount: 0, platform_fee_breakdown: [] }), false);
  assert.equal(
    resolveStoredOrComputedPlatformFee({
      order: { platform_fee_amount: 0, platform_fee_breakdown: [] },
      feeResult: { feeAmount: 80 },
      capAmount: 4000
    }),
    80
  );
});
