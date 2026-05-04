import crypto from 'crypto';
import Razorpay from 'razorpay';

export function isRazorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function getRazorpayPublicConfig() {
  return {
    isConfigured: isRazorpayConfigured(),
    keyId: process.env.RAZORPAY_KEY_ID || null
  };
}

function getRazorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    const error = new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    error.code = 'RAZORPAY_NOT_CONFIGURED';
    throw error;
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export async function createRazorpayOrder({ amountInRupees, receipt, notes = {} }) {
  const client = getRazorpayClient();
  const amountPaise = Math.round(Number(amountInRupees || 0) * 100);
  if (!amountPaise || amountPaise <= 0) {
    throw new Error('Invalid amount for Razorpay order');
  }
  const order = await client.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt,
    notes
  });
  return order;
}

export function verifyRazorpayPaymentSignature({ orderId, paymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const body = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return expected === signature;
}

export function verifyRazorpayWebhookSignature({ rawBody, signature }) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return expected === signature;
}

export async function fetchRazorpayPayment(paymentId) {
  const client = getRazorpayClient();
  return client.payments.fetch(paymentId);
}

export default {
  isRazorpayConfigured,
  getRazorpayPublicConfig,
  createRazorpayOrder,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  fetchRazorpayPayment
};
