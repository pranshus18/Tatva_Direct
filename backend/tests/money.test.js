import test from 'node:test';
import assert from 'node:assert/strict';
import { lineMoneyTotal, parseMoney, roundMoney } from '../utils/money.js';
import { parseOfferPrice } from '../services/catalogOfferSnapshotService.js';
import { pickEffectiveOfferPrice } from '../services/procurementSharedService.js';
import { lineGstFromOrderItemSnapshot } from '../services/gstService.js';

test('roundMoney rounds to paise', () => {
  assert.equal(roundMoney(10.1 * 3), 30.3);
  assert.equal(roundMoney(19.99 * 3), 59.97);
  assert.equal(roundMoney(NaN), 0);
});

test('parseMoney accepts Indian grouped strings and rupee prefixes', () => {
  assert.equal(parseMoney('1,250.50'), 1250.5);
  assert.equal(parseMoney('₹9,000'), 9000);
  assert.equal(parseMoney('Rs. 12,500.25'), 12500.25);
  assert.equal(parseMoney(10.105), 10.11);
  assert.equal(parseMoney(-5), 0);
  assert.equal(parseMoney(''), 0);
});

test('parseOfferPrice uses parseMoney so commas do not truncate the rupee amount', () => {
  assert.equal(parseOfferPrice('1,250.50'), 1250.5);
  assert.equal(parseOfferPrice(299), 299);
});

test('lineMoneyTotal avoids float remainders on unit × qty', () => {
  assert.equal(lineMoneyTotal(19.99, 3), 59.97);
  assert.equal(lineMoneyTotal(10.1, 3), 30.3);
  assert.equal(lineMoneyTotal('1,250.50', 2), 2501);
});

test('pickEffectiveOfferPrice never charges above MRP', () => {
  const aboveMrp = pickEffectiveOfferPrice(9000, { price: 10000, levelId: 'lvl' });
  assert.equal(aboveMrp.bcovApplied, false);
  assert.equal(aboveMrp.price, 9000);

  const equal = pickEffectiveOfferPrice(9000, { price: 9000.0000001, levelId: 'lvl' });
  assert.equal(equal.bcovApplied, false);
  assert.equal(equal.price, 9000);

  const deal = pickEffectiveOfferPrice(9000, { price: 8500, levelId: 'lvl-1' });
  assert.equal(deal.bcovApplied, true);
  assert.equal(deal.price, 8500);
  assert.equal(deal.bcovLevelId, 'lvl-1');
});

test('lineGstFromOrderItemSnapshot keeps explicit zero CGST/SGST', () => {
  const snapshot = lineGstFromOrderItemSnapshot({
    specifications: {
      gst: {
        taxType: 'CGST_SGST',
        taxableAmount: 1000,
        taxAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        totalAmount: 1000
      }
    }
  });
  assert.equal(snapshot.cgstAmount, 0);
  assert.equal(snapshot.sgstAmount, 0);
  assert.equal(snapshot.taxAmount, 0);
  assert.equal(snapshot.totalAmount, 1000);
});

test('lineGstFromOrderItemSnapshot splits missing CGST/SGST without leftover paise', () => {
  const snapshot = lineGstFromOrderItemSnapshot({
    specifications: {
      gst: {
        taxType: 'CGST_SGST',
        taxableAmount: 1000,
        taxAmount: 1.01
      }
    }
  });
  assert.equal(snapshot.cgstAmount, 0.51);
  assert.equal(snapshot.sgstAmount, 0.5);
  assert.equal(roundMoney(snapshot.cgstAmount + snapshot.sgstAmount), 1.01);
});
