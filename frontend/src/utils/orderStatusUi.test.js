import { describe, expect, it } from 'vitest';
import {
  formatPaymentStatusLabel,
  isOrderPaid,
  resolveEffectivePaymentStatus
} from './orderStatusUi';

describe('vault payment status', () => {
  it('treats vault held debit as paid even when paymentStatus is pending', () => {
    expect(
      resolveEffectivePaymentStatus({
        paymentStatus: 'pending',
        wallet_payment_status: 'held'
      })
    ).toBe('paid');
    expect(formatPaymentStatusLabel({ paymentStatus: 'pending', walletPaymentStatus: 'held' })).toBe(
      'Paid'
    );
  });

  it('treats an existing payment receipt as paid', () => {
    expect(
      isOrderPaid({
        paymentStatus: 'pending',
        receiptNumber: 'RCPT-1',
        receiptPdfUrl: 'https://example.com/receipt.pdf'
      })
    ).toBe(true);
  });

  it('keeps unpaid vault checkout pending', () => {
    expect(
      resolveEffectivePaymentStatus({
        paymentStatus: 'pending',
        paymentMethod: 'vault'
      })
    ).toBe('pending');
    expect(formatPaymentStatusLabel('pending')).toBe('Pending');
  });
});
