import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import { findOrderAccessibleByUser } from '../services/orderAccessService.js';
import { createReceiptPdfBuffer, loadReceiptItemsAndGst } from '../services/receiptPdfService.js';

const router = express.Router();

router.get('/order/:id', authenticateToken, async (req, res) => {
  try {
    const decodedId = decodeURIComponent(req.params.id);
    const order = await findOrderAccessibleByUser({
      orderIdentifier: decodedId,
      userId: req.userId
    });

    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to view this receipt'
      });
    }

    const { data: receipt, error } = await supabase.from('payment_receipts').select('*').eq('order_id', order.id).single();

    if (error || !receipt) {
      return res.status(404).json({
        status: 'error',
        message: 'Receipt not found for this order'
      });
    }

    return res.json({
      status: 'success',
      receipt
    });
  } catch (e) {
    console.error('Get receipt error:', e);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

router.get('/order/:id/download', authenticateToken, async (req, res) => {
  try {
    const decodedId = decodeURIComponent(req.params.id);
    const order = await findOrderAccessibleByUser({
      orderIdentifier: decodedId,
      userId: req.userId
    });

    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to view this receipt'
      });
    }

    const { data: receipt } = await supabase
      .from('payment_receipts')
      .select('*')
      .eq('order_id', order.id)
      .maybeSingle();

    if (!receipt) {
      return res.status(404).json({
        status: 'error',
        message: 'Receipt not found for this order'
      });
    }

    const [{ data: supplier }, { data: serviceProvider }] = await Promise.all([
      order?.supplier_id
        ? supabase
            .from('users')
            .select('id, name, company, email, phone, address, profile, user_type')
            .eq('id', order.supplier_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      order?.service_provider_id
        ? supabase
            .from('users')
            .select('id, name, company, email, phone, address, profile, user_type')
            .eq('id', order.service_provider_id)
            .maybeSingle()
        : Promise.resolve({ data: null })
    ]);

    const { items, gstSummary } = await loadReceiptItemsAndGst({
      order,
      supplier: supplier || null,
      serviceProvider: serviceProvider || null
    });

    const pdfBuffer = await createReceiptPdfBuffer({
      receipt,
      order,
      supplier: supplier || null,
      serviceProvider: serviceProvider || null,
      items,
      gstSummary
    });

    const filename = `${String(receipt.receipt_number || `RCPT-${order.order_number}`)}.pdf`.replaceAll('/', '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=\"${filename}\"`);
    return res.send(pdfBuffer);
  } catch (e) {
    console.error('Download receipt error:', e);
    const statusCode = Number(e?.statusCode) || 500;
    return res.status(statusCode).json({
      status: 'error',
      message: statusCode === 400 ? e.message : 'Internal server error'
    });
  }
});

export { router as receiptsRouter };
