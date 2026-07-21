import { confirmVaultTopup, createVaultTopup } from '../services/vaultService';

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
    throw new Error('Enter a valid amount');
  }
  if (numericAmount < minTopup) {
    throw new Error(`Minimum vault credit is INR ${minTopup}`);
  }

  const createData = await createVaultTopup({
    amount: numericAmount,
    idempotencyKey: `vault-topup-${Date.now()}`
  });
  const paymentIntent = createData.paymentIntent || {};
  const checkoutAmountPaise =
    Number(paymentIntent.amount) >= numericAmount * 100
      ? Number(paymentIntent.amount)
      : Math.round(numericAmount * 100);
  const scriptLoaded = await loadRazorpayScript();
  if (!scriptLoaded) {
    throw new Error('Unable to load Razorpay checkout');
  }

  return new Promise((resolve, reject) => {
    const options = {
      key: paymentIntent.keyId,
      order_id: paymentIntent.orderId,
      name: 'Tatva Direct',
      description: 'Vault top-up',
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
