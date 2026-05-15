import express from 'express';
import {
  requireAuthentication as authenticateToken,
  requireServiceProvider as isServiceProvider
} from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    integrated: true,
    websocketPath: '/api/voice/ws',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
});

router.get('/products/:productId/availability', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const productId = String(req.params.productId || '').trim();
    if (!productId) {
      return res.status(400).json({ status: 'error', message: 'productId is required' });
    }

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, status, is_active')
      .eq('id', productId)
      .maybeSingle();

    if (productError) throw productError;
    if (!product || String(product.status || '').toLowerCase() !== 'approved') {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }

    const { data: listings, error: listError } = await supabase
      .from('supplier_products')
      .select(
        `
        id,
        stock,
        availability_status,
        is_active,
        status,
        unit_price,
        supplier:users!supplier_products_supplier_id_fkey (id, name, company)
      `
      )
      .eq('product_id', productId)
      .eq('status', 'approved')
      .eq('is_active', true)
      .order('stock', { ascending: false });

    if (listError) throw listError;

    const offers = (listings || []).map((row) => ({
      supplierProductId: row.id,
      stock: row.stock ?? 0,
      availabilityStatus: row.availability_status || 'in_stock',
      unitPrice: row.unit_price,
      supplierName: row.supplier?.name || row.supplier?.company || 'Supplier'
    }));

    const totalStock = offers.reduce((sum, o) => sum + (Number(o.stock) || 0), 0);

    return res.json({
      status: 'success',
      productId,
      productName: product.name,
      inStock: totalStock > 0,
      totalStock,
      offers
    });
  } catch (error) {
    console.error('Voice availability error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to check availability' });
  }
});

export { router as voiceRouter };
