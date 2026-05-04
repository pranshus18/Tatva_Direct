import { supabase } from '../config/supabase.js';

/**
 * Create a simple double-entry ledger record.
 *
 * This is intentionally minimal:
 * - debit_account / credit_account are human-readable strings (e.g. "Accounts Receivable", "Sales Revenue")
 * - reference_type / reference_id link back to orders, invoices, or payment_receipts
 */
export async function recordLedgerEntry({
  debitAccount,
  creditAccount,
  amount,
  currency = 'INR',
  referenceType = null,
  referenceId = null,
  description = '',
  metadata = {}
}) {
  if (!debitAccount || !creditAccount || !amount || amount <= 0) {
    console.error('[Ledger] Invalid ledger entry payload', {
      debitAccount,
      creditAccount,
      amount
    });
    throw new Error('Invalid ledger entry payload');
  }

  const { error } = await supabase
    .from('ledger_entries')
    .insert({
      debit_account: debitAccount,
      credit_account: creditAccount,
      amount,
      currency,
      reference_type: referenceType,
      reference_id: referenceId,
      description,
      metadata
    });

  if (error) {
    console.error('[Ledger] Failed to insert ledger entry', error);
    throw new Error('Failed to insert ledger entry');
  }
}

export async function recordInvoiceLedger({ invoice, order }) {
  if (!invoice || !order) return;

  const amount = parseFloat(invoice.total_amount || order.total_amount || 0);
  if (!amount || amount <= 0) return;

  await recordLedgerEntry({
    debitAccount: 'Accounts Receivable',
    creditAccount: 'Sales Revenue',
    amount,
    currency: invoice.currency || 'INR',
    referenceType: 'invoice',
    referenceId: invoice.id,
    description: `Invoice ${invoice.invoice_number} for Order ${order.order_number}`,
    metadata: {
      orderId: order.id,
      orderNumber: order.order_number
    }
  });
}

export async function recordPaymentLedger({ receipt, order }) {
  if (!receipt || !order) return;

  const amount = parseFloat(receipt.amount || order.total_amount || 0);
  if (!amount || amount <= 0) return;

  await recordLedgerEntry({
    debitAccount: 'Cash/Bank',
    creditAccount: 'Accounts Receivable',
    amount,
    currency: receipt.currency || 'INR',
    referenceType: 'payment_receipt',
    referenceId: receipt.id,
    description: `Payment receipt ${receipt.receipt_number} for Order ${order.order_number}`,
    metadata: {
      orderId: order.id,
      orderNumber: order.order_number,
      paymentMethod: receipt.payment_method || null
    }
  });
}

