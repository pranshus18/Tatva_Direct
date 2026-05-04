import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  getRazorpayPublicConfig,
  isRazorpayConfigured,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature
} from '../services/razorpayService.js';

function restoreEnvVar(name, previousValue) {
  if (typeof previousValue === 'undefined') {
    delete process.env[name];
    return;
  }
  process.env[name] = previousValue;
}

test('verifyRazorpayPaymentSignature returns true for valid signature', () => {
  const previousSecret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_SECRET = 'payment-secret';

  const orderId = 'order_123';
  const paymentId = 'pay_abc';
  const signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const isValid = verifyRazorpayPaymentSignature({ orderId, paymentId, signature });
  assert.equal(isValid, true);

  restoreEnvVar('RAZORPAY_KEY_SECRET', previousSecret);
});

test('verifyRazorpayPaymentSignature returns false for invalid signature', () => {
  const previousSecret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_SECRET = 'payment-secret';

  const isValid = verifyRazorpayPaymentSignature({
    orderId: 'order_123',
    paymentId: 'pay_abc',
    signature: 'invalid-signature'
  });
  assert.equal(isValid, false);

  restoreEnvVar('RAZORPAY_KEY_SECRET', previousSecret);
});

test('verifyRazorpayWebhookSignature validates raw body signature', () => {
  const previousSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';

  const rawBody = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
  const signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const isValid = verifyRazorpayWebhookSignature({ rawBody, signature });
  assert.equal(isValid, true);

  restoreEnvVar('RAZORPAY_WEBHOOK_SECRET', previousSecret);
});

test('isRazorpayConfigured is false without keys', () => {
  const previousKeyId = process.env.RAZORPAY_KEY_ID;
  const previousSecret = process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;

  assert.equal(isRazorpayConfigured(), false);
  assert.deepEqual(getRazorpayPublicConfig(), { isConfigured: false, keyId: null });

  restoreEnvVar('RAZORPAY_KEY_ID', previousKeyId);
  restoreEnvVar('RAZORPAY_KEY_SECRET', previousSecret);
});
