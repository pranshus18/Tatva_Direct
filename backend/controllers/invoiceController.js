import { createInvoiceForOrder, getInvoiceForOrder } from '../services/invoiceService.js';
import { generateAndUploadInvoicePdf, saveInvoicePdfUrlToInvoice } from '../services/invoicePdfService.js';
import { findOrderAccessibleByUser } from '../services/orderAccessService.js';

export async function getInvoiceByOrder(req, res) {
  try {
    const decodedId = decodeURIComponent(req.params.id);
    const order = await findOrderAccessibleByUser({
      orderIdentifier: decodedId,
      userId: req.userId
    });

    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to view this invoice'
      });
    }

    const invoice = await getInvoiceForOrder(order.id);
    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        message: 'Invoice not found for this order'
      });
    }

    return res.json({ status: 'success', invoice });
  } catch (error) {
    console.error('Get invoice error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

export async function generateInvoiceByOrder(req, res) {
  try {
    const decodedId = decodeURIComponent(req.params.id);
    const order = await findOrderAccessibleByUser({
      orderIdentifier: decodedId,
      userId: req.userId
    });

    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to generate invoice for this order'
      });
    }

    const { invoice, created } = await createInvoiceForOrder(order, {
      issuedAt: req.body?.issuedAt || null,
      dueDate: req.body?.dueDate || null
    });

    let invoicePdfUrl = null;
    try {
      const { pdfUrl, pdfPath } = await generateAndUploadInvoicePdf({ order, invoice });
      invoicePdfUrl = pdfUrl || null;
      if (pdfUrl) {
        const updated = await saveInvoicePdfUrlToInvoice({ orderId: order.id, pdfUrl, pdfPath });
        if (updated?.metadata?.pdfUrl) invoicePdfUrl = updated.metadata.pdfUrl;
      }
    } catch (pdfErr) {
      console.error('[Invoices] PDF generation failed:', pdfErr);
    }

    return res.json({
      status: 'success',
      created,
      invoice,
      invoicePdfUrl
    });
  } catch (error) {
    console.error('Generate invoice error:', error);
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      status: 'error',
      message: statusCode === 400 ? error.message : 'Internal server error'
    });
  }
}
