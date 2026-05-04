import express from 'express';
import {
  requireAuthentication as authenticateToken,
  requireServiceProvider as isServiceProvider
} from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import { substitutionSuggestSchema } from '../contracts/vendorContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';

const router = express.Router();

router.post('/suggest', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(substitutionSuggestSchema, req.body || {});
    const { selectedVendors, items } = payload;

    const suggestions = [];

    for (const item of items) {
      const itemName = item.normalizedName || item.rawName || '';
      const itemId = item.id?.toString();
      const selectedVendorId = selectedVendors?.[itemId];

      if (!itemName) continue;

      let currentProduct = null;

      if (item.productId) {
        const { data: productById } = await supabase
          .from('products')
          .select(`
            *,
            supplier:users!products_supplier_id_fkey (id, name)
          `)
          .eq('id', item.productId)
          .single();

        currentProduct = productById;
      }

      if (!currentProduct) {
        const { data: productsByName } = await supabase
          .from('products')
          .select(`
            *,
            supplier:users!products_supplier_id_fkey (id, name)
          `)
          .ilike('name', `%${itemName}%`)
          .in('status', ['approved', 'pending'])
          .limit(1);

        if (productsByName && productsByName.length > 0) {
          currentProduct = productsByName[0];
        }
      }

      if (!currentProduct) continue;

      const currentPrice = parseFloat(currentProduct.price) || 0;
      const maxPrice = currentPrice * 1.1;

      const { data: alternatives } = await supabase
        .from('products')
        .select(`
          *,
          supplier:users!products_supplier_id_fkey (id, name, company)
        `)
        .eq('category', currentProduct.category)
        .eq('status', 'approved')
        .eq('is_active', true)
        .neq('id', currentProduct.id)
        .lte('price', maxPrice)
        .order('price', { ascending: true })
        .order('average_rating', { ascending: false })
        .limit(3);

      for (const alt of alternatives || []) {
        const altPrice = parseFloat(alt.price) || 0;
        const priceSavings = currentPrice - altPrice;
        const priceSavingsPercent = (priceSavings / currentPrice) * 100;

        const isBetterPrice = priceSavingsPercent >= 5;
        const altRating = parseFloat(alt.average_rating) || 0;
        const currentRating = parseFloat(currentProduct.average_rating) || 0;
        const isBetterRating = altRating > currentRating + 0.5 && priceSavingsPercent >= -5;

        if (isBetterPrice || isBetterRating) {
          const leadTime = (alt.stock || 0) > 500 ? 2 : (alt.stock || 0) > 100 ? 3 : 5;
          const currentLeadTime = (currentProduct.stock || 0) > 500 ? 2 : (currentProduct.stock || 0) > 100 ? 3 : 5;

          suggestions.push({
            id: `${itemId}-${alt.id}`,
            originalItem: itemName,
            originalPrice: currentPrice,
            originalLeadTime: currentLeadTime,
            originalProductId: currentProduct.id,
            suggestedItem: alt.name,
            suggestedPrice: altPrice,
            suggestedLeadTime: leadTime,
            suggestedProductId: alt.id,
            supplierName: alt.supplier?.name || alt.supplier?.company || 'Unknown',
            savings: priceSavings,
            savingsPercent: Math.round(priceSavingsPercent * 10) / 10,
            reason: isBetterPrice ? 'Lower price' : 'Better rating with similar price'
          });
        }
      }
    }

    res.json({ suggestions });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Substitution suggestion error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate substitution suggestions',
      error: error.message
    });
  }
});

export { router as substitutionRouter };
