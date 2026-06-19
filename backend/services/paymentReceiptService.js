import { supabase } from '../config/supabase.js';
import { sendEmail } from './emailService.js';
import { recordPaymentLedger } from './ledgerService.js';
import { generateAndAttachReceiptPdf } from './receiptPdfService.js';
import { insertNotification as insertNotificationRecord } from '../repositories/notificationsRepository.js';
import { findReceiptByOrderId, insertPaymentReceipt } from '../repositories/paymentReceiptsRepository.js';
import { findUserBasicById } from '../repositories/usersRepository.js';
import { formatPlatformDateTime } from '../utils/dateTime.js';

function formatINR(amount) {
  const n = Number(amount || 0);
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function buildReceiptEmail({ receipt, order, supplier, serviceProvider }) {
  const amountStr = formatINR(receipt.amount);
  const subject = `Payment Receipt - ${receipt.receipt_number} (Order ${order.order_number})`;

  const text = [
    `Payment Receipt`,
    ``,
    `Receipt: ${receipt.receipt_number}`,
    `Order: ${order.order_number}`,
    `Amount: ${amountStr} ${receipt.currency || 'INR'}`,
    `Payment Method: ${receipt.payment_method || 'N/A'}`,
    `Payment Reference: ${receipt.payment_reference || 'N/A'}`,
    `Paid At: ${formatPlatformDateTime(receipt.paid_at)}`,
    ``,
    `Service Provider: ${serviceProvider?.name || serviceProvider?.company || 'N/A'} (${serviceProvider?.email || 'N/A'})`,
    `Supplier: ${supplier?.name || supplier?.company || 'N/A'} (${supplier?.email || 'N/A'})`,
    ``,
    `This receipt was generated automatically for billing security and transparency.`
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.4;">
      <h2 style="margin:0 0 12px;">Payment Receipt</h2>
      <table cellpadding="6" cellspacing="0" border="0" style="border-collapse: collapse;">
        <tr><td><strong>Receipt</strong></td><td>${receipt.receipt_number}</td></tr>
        <tr><td><strong>Order</strong></td><td>${order.order_number}</td></tr>
        <tr><td><strong>Amount</strong></td><td>${amountStr} ${receipt.currency || 'INR'}</td></tr>
        <tr><td><strong>Payment Method</strong></td><td>${receipt.payment_method || 'N/A'}</td></tr>
        <tr><td><strong>Payment Reference</strong></td><td>${receipt.payment_reference || 'N/A'}</td></tr>
        <tr><td><strong>Paid At</strong></td><td>${formatPlatformDateTime(receipt.paid_at)}</td></tr>
      </table>
      <hr style="margin:16px 0;"/>
      <p style="margin:0;"><strong>Service Provider:</strong> ${serviceProvider?.name || serviceProvider?.company || 'N/A'} (${serviceProvider?.email || 'N/A'})</p>
      <p style="margin:6px 0 0;"><strong>Supplier:</strong> ${supplier?.name || supplier?.company || 'N/A'} (${supplier?.email || 'N/A'})</p>
      <p style="margin:16px 0 0; color:#555;">
        This receipt was generated automatically for billing security and transparency.
      </p>
    </div>
  `.trim();

  return { subject, text, html };
}

async function createReceiptNotification({ userId, orderId, title, message, metadata }) {
  if (!userId) return;
  try {
    await insertNotificationRecord({
      user_id: userId,
      type: 'payment_receipt',
      title,
      message,
      related_order_id: orderId,
      is_read: false,
      metadata: metadata || {}
    }, supabase);
  } catch (e) {
    console.error('[paymentReceipt] Failed to create notification:', e?.message || e);
  }
}

export async function getReceiptForOrderId(orderId) {
  const { data, error } = await findReceiptByOrderId(orderId, supabase);

  if (error) return { receipt: null, error };
  return { receipt: data, error: null };
}

export async function createReceiptIfMissing({
  order,
  paymentMethod,
  paymentReference,
  paidAt,
  actorUserId
}) {
  const receiptNumber = `RCPT-${order.order_number}`;
  const paidAtIso = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString();

  const payload = {
    receipt_number: receiptNumber,
    order_id: order.id,
    service_provider_id: order.service_provider_id,
    supplier_id: order.supplier_id,
    amount: order.total_amount,
    currency: 'INR',
    payment_method: paymentMethod || order.payment_method || null,
    payment_reference: paymentReference || null,
    paid_at: paidAtIso,
    metadata: {
      generatedBy: actorUserId || null,
      generatedAt: new Date().toISOString()
    }
  };

  // Insert; if unique violation happens, fetch existing
  const { data: inserted, error: insertError } = await insertPaymentReceipt(payload, supabase);

  if (!insertError && inserted) return { receipt: inserted, created: true };

  // Unique violation (receipt/order already has a receipt) -> fetch existing
  const { receipt } = await getReceiptForOrderId(order.id);
  if (receipt) return { receipt, created: false };

  // If we couldn't fetch it, bubble the original error
  throw insertError;
}

export async function createReceiptAndDeliver({
  order,
  paymentMethod,
  paymentReference,
  paidAt,
  actorUserId
}) {
  const { receipt, created } = await createReceiptIfMissing({
    order,
    paymentMethod,
    paymentReference,
    paidAt,
    actorUserId
  });

  // Fetch both parties for email + nicer notifications
  const [{ data: supplier }, { data: serviceProvider }] = await Promise.all([
    order.supplier_id
      ? findUserBasicById(order.supplier_id, supabase)
      : Promise.resolve({ data: null }),
    order.service_provider_id
      ? findUserBasicById(order.service_provider_id, supabase)
      : Promise.resolve({ data: null })
  ]);

  // Generate downloadable receipt PDF and attach URL to payment_receipts.metadata
  let receiptPdfUrl = null;
  let latestReceipt = receipt;
  try {
    const pdfResult = await generateAndAttachReceiptPdf({
      receipt,
      order,
      supplier,
      serviceProvider
    });
    receiptPdfUrl = pdfResult?.pdfUrl || null;
    latestReceipt = pdfResult?.receipt || receipt;
  } catch (e) {
    console.error('[paymentReceipt] Failed to generate receipt PDF:', e);
  }

  const amountStr = formatINR(receipt.amount);
  const notifTitle = 'Payment Receipt';
  const notifMsg = `Receipt ${receipt.receipt_number} generated for Order ${order.order_number} (${amountStr}).`;

  await Promise.all([
    createReceiptNotification({
      userId: order.supplier_id,
      orderId: order.id,
      title: notifTitle,
      message: notifMsg,
      metadata: { receiptNumber: receipt.receipt_number, receiptPdfUrl }
    }),
    createReceiptNotification({
      userId: order.service_provider_id,
      orderId: order.id,
      title: notifTitle,
      message: notifMsg,
      metadata: { receiptNumber: receipt.receipt_number, receiptPdfUrl }
    })
  ]);

  const email = buildReceiptEmail({ receipt: latestReceipt, order, supplier, serviceProvider });
  const emailHtml = receiptPdfUrl
    ? `${email.html}<p style="margin:12px 0 0;"><strong>Download Receipt PDF:</strong> <a href="${receiptPdfUrl}" target="_blank" rel="noopener noreferrer">${receiptPdfUrl}</a></p>`
    : email.html;
  const emailText = receiptPdfUrl
    ? `${email.text}\n\nDownload Receipt PDF: ${receiptPdfUrl}`
    : email.text;

  // Email both parties (if emails exist); safe fallback if email (OAuth2/SMTP) not configured.
  const emailResults = await Promise.all([
    serviceProvider?.email
      ? sendEmail({
          to: serviceProvider.email,
          subject: email.subject,
          text: emailText,
          html: emailHtml
        })
      : Promise.resolve({ ok: false, skipped: true, reason: 'no_service_provider_email' }),
    supplier?.email
      ? sendEmail({
          to: supplier.email,
          subject: email.subject,
          text: emailText,
          html: emailHtml
        })
      : Promise.resolve({ ok: false, skipped: true, reason: 'no_supplier_email' })
  ]);

  // Record financial ledger entry (Cash/Bank vs Accounts Receivable)
  try {
    await recordPaymentLedger({ receipt, order });
  } catch (e) {
    console.error('[paymentReceipt] Failed to record payment ledger entry:', e);
  }

  return { receipt: latestReceipt, created, emailResults, receiptPdfUrl };
}

