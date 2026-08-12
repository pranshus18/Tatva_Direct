import {
  normalizeModelIdentifier,
  sanitizeSpecifications,
  parseSpecificationsObject,
  countMeaningfulSpecValues,
  mergeSpecificationMaps,
  buildSpecificationTemplateFromFields,
  mergeVariantSpecificationTemplate,
  specificationTemplateKeysOnly
} from '../../services/supplierCatalogHelpersService.js';
import { normalizeBrandKey } from '../../services/supplyChainSharedService.js';

export async function upsertModelSpecProfile(supabase, {
  category,
  modelRaw,
  specifications,
  actorUserId
}) {
  const normalizedCategory = String(category || '').trim().toLowerCase();
  const modelIdentifier = normalizeModelIdentifier(modelRaw);
  const safeSpecs = sanitizeSpecifications(specifications);

  if (!normalizedCategory || !modelIdentifier || Object.keys(safeSpecs).length === 0) {
    return null;
  }

  const payload = {
    category: normalizedCategory,
    model_identifier: modelIdentifier,
    display_model: String(modelRaw || '').trim() || modelIdentifier,
    specifications: safeSpecs,
    updated_by: actorUserId || null
  };

  const { data, error } = await supabase
    .from('model_spec_profiles')
    .upsert(payload, { onConflict: 'category,model_identifier' })
    .select('*')
    .single();

  if (error) {
    console.error('[Model Specs] upsert error:', error);
    return null;
  }

  return data;
}

export async function fetchApprovedCatalogSpecificationRows(supabase, categoryName, brandKey = '') {
  const { data: rows, error } = await supabase
    .from('products')
    .select('id, name, brand, specifications, status, updated_at')
    .eq('category', categoryName)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('❌ [GET SPECS] Catalog product fetch error:', error);
    return [];
  }

  return (rows || []).filter((row) => {
    const status = String(row?.status ?? '').trim().toLowerCase();
    if (status && status !== 'approved') return false;
    if (!brandKey) return true;
    const rowBrand = normalizeBrandKey(row?.brand || '');
    return rowBrand && rowBrand === brandKey;
  });
}

export function pickBestSpecificationMap(rows = [], options = {}) {
  const excludeProductId = options.excludeProductId || null;
  let best = null;
  let bestScore = -1;
  for (const row of rows) {
    if (excludeProductId && row?.id === excludeProductId) continue;
    const specs = parseSpecificationsObject(row?.specifications);
    if (!specs || Object.keys(specs).length === 0) continue;
    const score = countMeaningfulSpecValues(specs) * 1000 + Object.keys(specs).length;
    if (score > bestScore) {
      bestScore = score;
      best = specs;
    }
  }
  return best;
}

export async function loadSpecTemplateForCategory(supabase, category, familyId = null) {
  const categoryValue = String(category || '').trim().toLowerCase();
  if (!categoryValue) return { template: null, fields: [] };

  let query = supabase
    .from('spec_templates')
    .select('*')
    .eq('category', categoryValue)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1);

  if (familyId) {
    query = query.eq('family_id', familyId);
  } else {
    query = query.is('family_id', null);
  }

  const { data: template } = await query.maybeSingle();
  if (!template) return { template: null, fields: [] };

  const { data: fields } = await supabase
    .from('spec_template_fields')
    .select('*')
    .eq('template_id', template.id)
    .order('sort_order', { ascending: true });

  return { template, fields: fields || [] };
}

/** Resolve admin-defined specification keys/values for a category + model + brand. */
export async function resolveAdminSpecificationTemplate(supabase, {
  categoryName: rawCategory,
  modelRaw = '',
  brandRaw = '',
  excludeProductId = null,
  keysOnly = false
} = {}) {
  const categoryName = String(rawCategory || '').trim().toLowerCase();
  if (!categoryName) return {};

  const modelIdentifier = normalizeModelIdentifier(modelRaw);

  let { data: category } = await supabase
    .from('categories')
    .select('name, display_name, default_specifications')
    .eq('name', categoryName)
    .maybeSingle();

  if (!category) {
    const { data: allCategories } = await supabase
      .from('categories')
      .select('name, display_name, default_specifications')
      .eq('is_active', true);
    category = (allCategories || []).find((cat) => String(cat?.name || '').toLowerCase() === categoryName);
  }

  // Category defaults often contain example values (e.g. "Wireless Mouse" for Computer Accessories).
  // Those are KEY scaffolding only — never treat them as this product's filled specs.
  let templateSkeleton = {};
  if (category) {
    const defaultSpecs = parseSpecificationsObject(category.default_specifications);
    if (defaultSpecs && Object.keys(defaultSpecs).length > 0) {
      templateSkeleton = defaultSpecs;
    }
  }
  const { fields } = await loadSpecTemplateForCategory(supabase, categoryName);
  const fieldTemplate = buildSpecificationTemplateFromFields(fields);
  if (Object.keys(fieldTemplate).length > 0) {
    templateSkeleton = mergeSpecificationMaps(fieldTemplate, templateSkeleton);
  }
  templateSkeleton = specificationTemplateKeysOnly(templateSkeleton);

  if (keysOnly) {
    return templateSkeleton;
  }

  let specs = { ...templateSkeleton };

  // Only exact model matches may contribute filled values.
  // Never copy the "richest" brand/category sibling (that turned headphones into a mouse).
  if (modelIdentifier) {
    const { data: profile, error: profileError } = await supabase
      .from('model_spec_profiles')
      .select('specifications')
      .eq('category', categoryName)
      .eq('model_identifier', modelIdentifier)
      .maybeSingle();
    if (profileError) {
      console.error('resolveAdminSpecificationTemplate model profile error:', profileError);
    } else {
      const profileSpecs = parseSpecificationsObject(profile?.specifications);
      if (profileSpecs && Object.keys(profileSpecs).length > 0) {
        specs = mergeSpecificationMaps(specs, profileSpecs);
      }
    }

    const { data: productMatches, error: productMatchError } = await supabase
      .from('products')
      .select('id, name, specifications, status, updated_at')
      .eq('category', categoryName)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (productMatchError) {
      console.error('resolveAdminSpecificationTemplate product match error:', productMatchError);
    } else {
      const modelRows = (productMatches || []).filter((row) => {
        if (excludeProductId && row?.id === excludeProductId) return false;
        const status = String(row?.status ?? '').trim().toLowerCase();
        if (status && status !== 'approved') return false;
        const normalizedName = normalizeModelIdentifier(row?.name || '');
        return normalizedName && normalizedName === modelIdentifier;
      });
      const matchSpecs = pickBestSpecificationMap(modelRows, { excludeProductId });
      if (matchSpecs) {
        specs = mergeSpecificationMaps(specs, matchSpecs);
      }
    }
  }

  return specs;
}

export async function enrichProductSpecificationsForDisplay(supabase, {
  category,
  name,
  brand,
  existingSpecs,
  productId = null
}) {
  const storedSpecs = parseSpecificationsObject(existingSpecs) || {};
  // Known catalog product: return that product's (and offer-overlay) specs only.
  // Do not scaffold unrelated category example keys (mouse fields on headphones).
  if (productId && Object.keys(storedSpecs).length > 0) {
    return storedSpecs;
  }
  const adminTemplate = await resolveAdminSpecificationTemplate(supabase, {
    categoryName: category,
    modelRaw: name,
    brandRaw: String(brand || name || '').trim(),
    excludeProductId: productId,
    keysOnly: true
  });
  return mergeVariantSpecificationTemplate(adminTemplate, storedSpecs);
}

/** Discovery detail: all template fields for the variant, preserving empty supplier values. */
export async function enrichVariantSpecificationsForDiscovery(supabase, {
  category,
  name,
  brand,
  existingSpecs,
  productId = null
}) {
  const storedSpecs = parseSpecificationsObject(existingSpecs) || {};
  const adminTemplate = await resolveAdminSpecificationTemplate(supabase, {
    categoryName: category,
    modelRaw: name,
    brandRaw: String(brand || name || '').trim(),
    excludeProductId: productId,
    keysOnly: true
  });
  return mergeVariantSpecificationTemplate(adminTemplate, storedSpecs);
}
