/** Supplier routes: catalog */
import {
  getContractErrorMessage,
  normalizeBrandKey,
  normalizeModelIdentifier,
  parseWithSchema,
  resolveUpstreamBrandLabel,
  searchProductDiscoveryForUser,
  supplierCanAccessBrandStrict,
  supplierCategoryCreateSchema,
  supplierUnitCreateSchema
} from './supplierImports.js';
import { listSupplierSelectableBrands } from '../../services/supplierBrandCatalogService.js';
export function registerSupplierCatalogRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase,
    enrichProductSpecificationsForDisplay,
    resolveAdminSpecificationTemplate
  } = ctx;

router.get('/products/search', authenticateToken, async (req, res) => {
  try {
    const { q, category } = req.query;
    const parsedLimit = Number.parseInt(String(req.query.limit || ''), 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 50)
      : 20;
    const parsedPage = Number.parseInt(String(req.query.page || ''), 10);
    const page = Number.isFinite(parsedPage) ? Math.max(parsedPage, 1) : 1;
    const parsedOffset = Number.parseInt(String(req.query.offset || ''), 10);
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : (page - 1) * limit;

    const result = await searchProductDiscoveryForUser(supabase, {
      userId: req.userId,
      q,
      category,
      limit,
      page,
      offset,
      legacyManualDiscoveryCategoryFilter: true
    });
    const isSupplierUser = String(req.user?.user_type || '').trim().toLowerCase() === 'supplier';
    const visibleSuggestions = isSupplierUser
      ? (result.suggestions || []).filter((s) => {
          const brandLabel = resolveUpstreamBrandLabel(
            { brandModel: s?.brandModel || s?.modelBrand || s?.brand, brand: s?.brand },
            s?.brand
          );
          return supplierCanAccessBrandStrict(req.user?.profile || {}, brandLabel).allowed;
        })
      : (result.suggestions || []);
    const responseTotal = isSupplierUser ? visibleSuggestions.length : result.total;

    return res.json({
      status: 'success',
      suggestions: visibleSuggestions,
      total: responseTotal,
      limit: result.limit,
      offset: result.offset,
      recommendationMode: result.recommendationMode
    });
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Lookup a product by exact name + category and return its unit (for auto-fill)
router.get('/products/lookup', authenticateToken, async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    const category = String(req.query.category || '').trim().toLowerCase();
    const brandRaw = String(req.query.brand || req.query.brandName || '').trim();
    const brandKey = brandRaw ? normalizeBrandKey(brandRaw) : '';

    if (!name || !category) {
      return res.json({
        status: 'success',
        found: false
      });
    }

    // In production, product names often contain extra spaces / casing differences
    // (and sometimes trailing whitespace). Using an exact ilike() match can fail,
    // which then prevents spec prefill. Fetch a small candidate set and pick
    // the closest normalized name.
    const nameNeedle = name.replace(/\s+/g, ' ').trim();
    const ilikeNeedle = `%${nameNeedle.replace(/\s+/g, '%')}%`;
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, category, brand, unit, specifications, updated_at')
      .eq('category', category)
      .ilike('name', ilikeNeedle)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Product lookup error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }

    const normalizeName = (v) =>
      String(v || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

    const productCandidates = products || [];
    const needleNorm = normalizeName(nameNeedle);
    let product = productCandidates.length > 0 ? productCandidates[0] : null;
    const exact = productCandidates.find((p) => normalizeName(p?.name) === needleNorm);
    if (exact) product = exact;
    if (product) {
      const productBrandLabel = resolveUpstreamBrandLabel({}, product?.brand || '');
      const brandAllowed = supplierCanAccessBrandStrict(req.user?.profile || {}, productBrandLabel);
      if (!brandAllowed.allowed) {
        product = null;
      }
    }
    const toObject = (value) => {
      if (!value) return null;
      if (typeof value === 'object') {
        // If it's already a plain object (most common case), keep it.
        if (!Array.isArray(value)) return value;

        // Handle legacy formats where specifications are stored as an array of key/value items.
        // Examples that we attempt:
        //   [{ key: "brandModel", value: "X" }]
        //   [{ name: "brandModel", value: "X" }]
        //   [["brandModel","X"], ...]
        if (Array.isArray(value)) {
          const out = {};
          for (const item of value) {
            if (!item) continue;
            if (Array.isArray(item) && item.length >= 2) {
              const k = String(item[0] ?? '').trim();
              if (!k) continue;
              out[k] = item[1];
              continue;
            }
            if (typeof item === 'object') {
              const k = String(item.key ?? item.name ?? '').trim();
              if (!k) continue;
              const v = item.value;
              out[k] = v;
            }
          }
          return Object.keys(out).length > 0 ? out : null;
        }
      }
      if (typeof value === 'string') {
        try {
          // Some production rows are double-encoded JSON strings.
          let parsed = JSON.parse(value);
          if (typeof parsed === 'string') {
            try {
              parsed = JSON.parse(parsed);
            } catch {
              // keep as-is
            }
          }
          if (parsed && typeof parsed === 'object') {
            if (!Array.isArray(parsed)) return parsed;

            // If parsed into an array, try converting to object (same logic as above).
            if (Array.isArray(parsed)) {
              const out = {};
              for (const item of parsed) {
                if (!item) continue;
                if (Array.isArray(item) && item.length >= 2) {
                  const k = String(item[0] ?? '').trim();
                  if (!k) continue;
                  out[k] = item[1];
                  continue;
                }
                if (typeof item === 'object') {
                  const k = String(item.key ?? item.name ?? '').trim();
                  if (!k) continue;
                  out[k] = item.value;
                }
              }
              return Object.keys(out).length > 0 ? out : null;
            }
          }
        } catch {
          return null;
        }
      }
      return null;
    };

    let mergedSpecifications =
      toObject(product?.specifications) ? { ...toObject(product.specifications) } : {};

    if (product?.id) {
      const { data: approvedSpecOffers } = await supabase
        .from('supplier_products')
        .select('attributes, updated_at, status')
        .eq('product_id', product.id)
        .order('updated_at', { ascending: false })
        .limit(200);

      const isMeaningfullyFilled = (v) => {
        if (v === null || v === undefined) return false;
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === 'object') return Object.keys(v).length > 0;
        if (typeof v === 'number') return Number.isFinite(v);
        if (typeof v === 'boolean') return true;
        return String(v).trim() !== '';
      };
      const nonEmptyValueCount = (specsObj) =>
        Object.values(specsObj || {}).filter(isMeaningfullyFilled).length;

      let bestSpecs = null;
      for (const row of approvedSpecOffers || []) {
        const status = String(row?.status || '').trim().toLowerCase();
        if (status !== 'approved') continue;
        const attributesObj = toObject(row?.attributes);
        let specs = toObject(attributesObj?.specifications ?? attributesObj?.specs ?? attributesObj?.specification);

        // Backward-compat: some older rows can carry spec keys directly in attributes.
        if (!specs && attributesObj && typeof attributesObj === 'object' && !Array.isArray(attributesObj)) {
          const direct = {};
          Object.keys(attributesObj || {}).forEach((k) => {
            if (['description', 'name', 'images', 'brandModel', 'lsa', 'hsnCode'].includes(k)) return;
            direct[k] = attributesObj[k];
          });
          if (Object.keys(direct).length > 0) specs = direct;
        }

        if (!specs) continue;
        if (!bestSpecs || nonEmptyValueCount(specs) > nonEmptyValueCount(bestSpecs)) {
          bestSpecs = specs;
        }
      }

      if (bestSpecs) {
        Object.keys(bestSpecs).forEach((k) => {
          const v = bestSpecs[k];
          if (v !== undefined && v !== null) {
            if (isMeaningfullyFilled(v) || !Object.prototype.hasOwnProperty.call(mergedSpecifications, k)) {
              mergedSpecifications[k] = v;
            }
          } else if (!Object.prototype.hasOwnProperty.call(mergedSpecifications, k)) {
            mergedSpecifications[k] = v;
          }
        });
      }
    }

    const lookupCategory = String(product?.category || category || '').trim().toLowerCase();
    const lookupName = String(product?.name || name || '').trim();
    const brandHint = brandRaw || lookupName;
    if (lookupCategory) {
      mergedSpecifications = await enrichProductSpecificationsForDisplay({
        category: lookupCategory,
        name: lookupName,
        brand: brandHint,
        existingSpecs: mergedSpecifications,
        productId: product?.id || null
      });
    }

    // If product exists, calculate recommended price as average of all suppliers' prices
    // Prefer excluding the current supplier (so they see market average) when possible.
    let recommendedPrice = null;
    let avgPriceAll = null;
    let avgPriceOthers = null;
    let supplierCountAll = 0;
    let supplierCountOthers = 0;
    let minPrice = null;
    let maxPrice = null;
    if (product?.id) {
      const { data: supplierOffers, error: offersError } = await supabase
        .from('supplier_products')
        .select('price, supplier_id, status, is_active, variant_key')
        .eq('product_id', product.id)
        .neq('status', 'rejected');

      if (offersError) {
        console.error('Recommended price lookup error:', offersError);
      } else {
        const offers = (supplierOffers || [])
          .filter((o) => String(o?.status || '').toLowerCase() === 'approved' && o?.is_active === true)
          .map(o => ({
            price: typeof o.price === 'string' ? parseFloat(o.price) : Number(o.price),
            supplier_id: o.supplier_id
          }))
          .filter(o => Number.isFinite(o.price) && o.price >= 0);

        supplierCountAll = offers.length;
        if (supplierCountAll > 0) {
          const sumAll = offers.reduce((sum, o) => sum + o.price, 0);
          avgPriceAll = sumAll / supplierCountAll;
          minPrice = Math.min(...offers.map(o => o.price));
          maxPrice = Math.max(...offers.map(o => o.price));

          const otherOffers = offers.filter(o => o.supplier_id !== req.userId);
          supplierCountOthers = otherOffers.length;
          if (supplierCountOthers > 0) {
            const sumOthers = otherOffers.reduce((sum, o) => sum + o.price, 0);
            avgPriceOthers = sumOthers / supplierCountOthers;
          }

          recommendedPrice = supplierCountOthers > 0 ? avgPriceOthers : avgPriceAll;
        }
      }
    }

    return res.json({
      status: 'success',
      found: !!product,
      product: product
        ? { id: product.id, name: product.name, category: product.category, unit: product.unit }
        : null,
      unit: product?.unit || null,
      specifications: mergedSpecifications
      ,
      // Price recommendation (average across suppliers for this product)
      recommendedPrice: recommendedPrice,
      priceStats: {
        avgPriceAll,
        avgPriceOthers,
        supplierCountAll,
        supplierCountOthers,
        minPrice,
        maxPrice
      }
    });
  } catch (error) {
    console.error('Product lookup error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get all categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('categories')
      .select('name, display_name, default_specifications')
      .eq('is_active', true)
      .order('name', { ascending: true });
    
    if (error) {
      throw error;
    }
    
    // Transform to match expected format
    const formattedCategories = (categories || []).map(cat => ({
      name: cat.name,
      displayName: cat.display_name,
      defaultSpecifications: cat.default_specifications || {}
    }));
    
    res.json({ 
      status: 'success',
      categories: formattedCategories
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Get default specifications for a given category
router.get('/categories/:name/specifications', authenticateToken, async (req, res) => {
  try {
    const rawName = req.params.name || '';
    const categoryName = rawName.trim().toLowerCase();
    const modelRaw = String(
      req.query.model || req.query.mpn || req.query.brandModel || ''
    ).trim();
    const modelIdentifier = normalizeModelIdentifier(modelRaw);
    const brandRaw = String(req.query.brand || req.query.brandName || '').trim();
    const brandKey = brandRaw ? normalizeBrandKey(brandRaw) : '';

    console.log(`🔍 [GET SPECS] Request for category: "${rawName}" -> normalized: "${categoryName}"`);

    if (!categoryName) {
      return res.status(400).json({
        status: 'error',
        message: 'Category name is required'
      });
    }

    // Find category - try exact match first
    let { data: category, error } = await supabase
      .from('categories')
      .select('name, display_name, default_specifications')
      .eq('name', categoryName)
      .single();

    // If not found, try case-insensitive search
    if (error || !category) {
      const { data: allCategories } = await supabase
        .from('categories')
        .select('name, display_name, default_specifications')
        .eq('is_active', true);
      
      category = (allCategories || []).find(cat => cat.name.toLowerCase() === categoryName);
      
      if (!category) {
        console.log(`❌ [GET SPECS] Category "${categoryName}" not found`);
        return res.status(404).json({
          status: 'error',
          message: 'Category not found'
        });
      }
    }

    console.log(`✅ [GET SPECS] Category "${categoryName}" found`);

    const specs = await resolveAdminSpecificationTemplate({
      categoryName,
      modelRaw,
      brandRaw: brandRaw || modelRaw
    });

    return res.json({
      status: 'success',
      category: {
        name: category.name,
        displayName: category.display_name || category.name
      },
      source: 'resolved',
      model: modelIdentifier
        ? { modelIdentifier, displayModel: modelRaw || modelIdentifier }
        : null,
      specifications: specs
    });
  } catch (error) {
    console.error('❌ [GET SPECS] Get category specifications error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Create or get category
router.post('/categories', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierCategoryCreateSchema, req.body || {});
    const { name, displayName } = payloadInput;
    
    if (!name || !name.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Category name is required'
      });
    }
    
    const categoryName = name.trim().toLowerCase();
    
    // Check if category already exists
    let { data: category, error: fetchError } = await supabase
      .from('categories')
      .select('*')
      .eq('name', categoryName)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found
      throw fetchError;
    }
    
    if (!category) {
      // Create new category
      const { data: newCategory, error: createError } = await supabase
        .from('categories')
        .insert({
        name: categoryName,
          display_name: displayName || name.trim(),
          created_by: req.userId,
          is_active: true
        })
        .select()
        .single();
      
      if (createError) {
        throw createError;
      }
      
      category = newCategory;
    } else if (!category.is_active) {
      // Reactivate if it was deactivated
      const { data: updatedCategory, error: updateError } = await supabase
        .from('categories')
        .update({ is_active: true })
        .eq('id', category.id)
        .select()
        .single();
      
      if (updateError) {
        throw updateError;
      }
      
      category = updatedCategory;
    }
    
    res.json({ 
      status: 'success',
      message: 'Category processed successfully',
      category 
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Create category error:', error);
    
    if (error.code === '23505') { // Unique violation
      const { data: existingCategory } = await supabase
        .from('categories')
        .select('*')
        .eq('name', String(req.body?.name || '').trim().toLowerCase())
        .single();
      
      return res.json({ 
        status: 'success',
        message: 'Category already exists',
        category: existingCategory
      });
    }
    
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Get all units
router.get('/units', authenticateToken, async (req, res) => {
  try {
    const { data: units, error } = await supabase
      .from('units')
      .select('name, display_name')
      .eq('is_active', true)
      .order('name', { ascending: true });
    
    if (error) {
      throw error;
    }
    
    // Transform to match expected format
    const formattedUnits = (units || []).map(unit => ({
      name: unit.name,
      displayName: unit.display_name
    }));
    
    res.json({ 
      status: 'success',
      units: formattedUnits
    });
  } catch (error) {
    console.error('Get units error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Create or get unit
router.post('/units', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierUnitCreateSchema, req.body || {});
    const { name, displayName } = payloadInput;
    
    if (!name || !name.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Unit name is required'
      });
    }
    
    const unitName = name.trim().toLowerCase();
    
    // Check if unit already exists
    let { data: unit, error: fetchError } = await supabase
      .from('units')
      .select('*')
      .eq('name', unitName)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }
    
    if (!unit) {
      // Create new unit
      const { data: newUnit, error: createError } = await supabase
        .from('units')
        .insert({
        name: unitName,
          display_name: displayName || name.trim(),
          created_by: req.userId,
          is_active: true
        })
        .select()
        .single();
      
      if (createError) {
        throw createError;
      }
      
      unit = newUnit;
    } else if (!unit.is_active) {
      // Reactivate if it was deactivated
      const { data: updatedUnit, error: updateError } = await supabase
        .from('units')
        .update({ is_active: true })
        .eq('id', unit.id)
        .select()
        .single();
      
      if (updateError) {
        throw updateError;
      }
      
      unit = updatedUnit;
    }
    
    res.json({ 
      status: 'success',
      message: 'Unit processed successfully',
      unit 
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Create unit error:', error);
    
    if (error.code === '23505') { // Unique violation
      const { data: existingUnit } = await supabase
        .from('units')
        .select('*')
        .eq('name', String(req.body?.name || '').trim().toLowerCase())
        .single();
      
      return res.json({ 
        status: 'success',
        message: 'Unit already exists',
        unit: existingUnit
      });
    }
    
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

router.get('/brands', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can list brands' });
    }

    const brands = await listSupplierSelectableBrands(supabase, {
      profile: req.user?.profile || {}
    });

    return res.json({
      status: 'success',
      brands
    });
  } catch (error) {
    console.error('Supplier brands list error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to load brand list'
    });
  }
});

// Add new product
}
