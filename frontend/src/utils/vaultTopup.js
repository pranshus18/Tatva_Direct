import { confirmVaultTopup, createVaultTopup } from '../services/vaultService';

/** Convert INR rupees → paise for Razorpay checkout only (1 INR = 100 paise). */
export function inrToPaise(amountInRupees) {
  const n = Number(amountInRupees);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

export function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export async function startVaultTopup({
  amount,
  minTopupInr = 100,
  onSuccess,
  onError,
  onDismiss
}) {
  const numericAmount = Number(amount);
  const minTopup = Number(minTopupInr || 100);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Enter a valid amount in Indian rupees');
  }
  if (numericAmount < minTopup) {
    throw new Error(`Minimum vault credit is ₹${minTopup}`);
  }

  const createData = await createVaultTopup({
    amount: numericAmount,
    idempotencyKey: `vault-topup-${Date.now()}`
  });
  const paymentIntent = createData.paymentIntent || {};

  // App amounts are always INR. Convert to paise only for Razorpay.
  const amountInRupees = Number(
    paymentIntent.amountInRupees ?? paymentIntent.amount ?? numericAmount
  );
  const checkoutAmountPaise = Number.isFinite(Number(paymentIntent.amountPaise))
    ? Math.round(Number(paymentIntent.amountPaise))
    : inrToPaise(amountInRupees);

  const scriptLoaded = await loadRazorpayScript();
  if (!scriptLoaded) {
    throw new Error('Unable to load Razorpay checkout');
  }

  return new Promise((resolve, reject) => {
    const options = {
      key: paymentIntent.keyId,
      order_id: paymentIntent.orderId,
      name: 'Tatva Direct',
      description: `Vault top-up · ₹${Number(amountInRupees).toLocaleString('en-IN')}`,
      amount: checkoutAmountPaise,
      currency: paymentIntent.currency || 'INR',
      handler: async (response) => {
        try {
          await confirmVaultTopup({
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature
          });
          if (onSuccess) await onSuccess();
          resolve({ status: 'success' });
        } catch (error) {
          if (onError) onError(error);
          reject(error);
        }
      },
      modal: {
        ondismiss: () => {
          if (onDismiss) onDismiss();
          reject(new Error('Payment cancelled'));
        }
      },
      theme: { color: '#0a0a0a' }
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', (response) => {
      const message = response?.error?.description || 'Payment failed';
      if (onError) onError(new Error(message));
      reject(new Error(message));
    });
    rzp.open();
  });
}
