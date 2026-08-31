/** Unify leftover duplicate variant keys/TSINs that represent the same catalog variant. */

import { extractOfferSpecificationsFromRow } from './supplierCatalogHelpersService.js';
import { countMeaningfulSpecValues } from './supplierCatalogHelpersService.js';
import { specsRepresentSameCatalogVariant } from '../utils/supplierProductApproval.js';
import {
  buildVariantAsinLikeId,
  isCurrentVariantTsin
} from './productIdentityService.js';
import { propagateVariantMrpToAllOffers, roundVariantMrp } from './variantMrpService.js';

function offerReuseRank(row = {}) {
  const status = String(row?.status || '').toLowerCase();
  if (status === 'approved' && row?.is_active !== false) return 0;
  if (status === 'approved') return 1;
  if (status === 'pending') return 2;
  return 3;
}

function offerHasPositiveMrp(row = {}) {
  const price = roundVariantMrp(row?.price);
  return price !== null && price > 0;
}

function outletSlotKey(row = {}) {
  return `${String(row?.supplier_id || '').trim()}::${String(row?.product_id || '').trim()}::${String(row?.outlet_id || '').trim()}`;
}

function specsAreBlank(specs) {
  return countMeaningfulSpecValues(specs || {}) === 0;
}

export function offersRepresentSameCatalogVariant(left, right, catalogSpecs = {}) {
  const leftKey = String(left?.variant_key || '').trim();
  const rightKey = String(right?.variant_key || '').trim();
  if (leftKey && rightKey && leftKey === rightKey) return true;

  const leftSpecs = extractOfferSpecificationsFromRow(left);
  const rightSpecs = extractOfferSpecificationsFromRow(right);
  const catalogFilled = !specsAreBlank(catalogSpecs);
  // Blank-vs-blank with no catalog values would otherwise collapse every
  // spec-less offer on a product into one variant.
  if (!catalogFilled && specsAreBlank(leftSpecs) && specsAreBlank(rightSpecs)) {
    return false;
  }
  return specsRepresentSameCatalogVariant(leftSpecs, rightSpecs, catalogSpecs);
}

export function clusterOffersBySameCatalogVariant(offers = [], catalogSpecs = {}) {
  const rows = (offers || []).filter(
    (row) => String(row?.status || '').toLowerCase() !== 'rejected'
  );
  const parent = rows.map((_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const union = (left, right) => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft !== rootRight) parent[rootLeft] = rootRight;
  };

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (offersRepresentSameCatalogVariant(rows[i], rows[j], catalogSpecs)) {
        union(i, j);
      }
    }
  }

  const clusters = new Map();
  rows.forEach((row, index) => {
    const root = find(index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(row);
  });
  return [...clusters.values()];
}

export function pickCanonicalOfferForVariantCluster(cluster = []) {
  return [...(cluster || [])].sort((left, right) => {
    const leftPriced = offerHasPositiveMrp(left) ? 0 : 1;
    const rightPriced = offerHasPositiveMrp(right) ? 0 : 1;
    if (leftPriced !== rightPriced) return leftPriced - rightPriced;
    const rankDiff = offerReuseRank(left) - offerReuseRank(right);
    if (rankDiff !== 0) return rankDiff;
    return new Date(left?.created_at || 0).getTime() - new Date(right?.created_at || 0).getTime();
  })[0] || null;
}

function clusterWouldViolateOfferUniqueness(cluster = [], variantKey) {
  const slots = new Map();
  for (const row of cluster || []) {
    const slot = outletSlotKey(row);
    if (!slots.has(slot)) slots.set(slot, []);
    slots.get(slot).push(row);
  }
  for (const group of slots.values()) {
    if (group.length < 2) continue;
    const alreadyCanonical = group.filter(
      (row) => String(row?.variant_key || '').trim() === variantKey
    ).length;
    const wouldGainCanonical = group.length - alreadyCanonical;
    if (alreadyCanonical + wouldGainCanonical > 1 && alreadyCanonical >= 1) {
      return true;
    }
    if (group.length > 1 && wouldGainCanonical === group.length) {
      return true;
    }
  }
  return false;
}

export function planCatalogVariantIdentityCoalesce({
  parentAsin = '',
  catalogSpecs = {},
  offers = []
} = {}) {
  const clusters = clusterOffersBySameCatalogVariant(offers, catalogSpecs);
  const patches = [];

  for (const cluster of clusters) {
    const distinctKeys = [
      ...new Set(cluster.map((row) => String(row?.variant_key || '').trim()).filter(Boolean))
    ];
    const distinctAsins = [
      ...new Set(
        cluster.map((row) => String(row?.variant_asin || '').trim().toUpperCase()).filter(Boolean)
      )
    ];
    if (distinctKeys.length <= 1 && distinctAsins.length <= 1) continue;

    const canonical = pickCanonicalOfferForVariantCluster(cluster);
    const variantKey = String(canonical?.variant_key || '').trim();
    if (!variantKey || clusterWouldViolateOfferUniqueness(cluster, variantKey)) continue;

    const storedAsin = String(canonical?.variant_asin || '').trim().toUpperCase();
    const variantAsin = isCurrentVariantTsin(parentAsin, storedAsin)
      ? storedAsin
      : buildVariantAsinLikeId(parentAsin, variantKey) || storedAsin;
    if (!variantAsin) continue;

    const productVariantId = canonical?.product_variant_id || null;
    const clusterPrices = [
      ...new Set(
        cluster
          .map((row) => roundVariantMrp(row?.price))
          .filter((price) => price !== null && price > 0)
      )
    ];
    const hasUnpriced = cluster.some((row) => !offerHasPositiveMrp(row));
    const canonicalMrp =
      clusterPrices.length === 1
        ? clusterPrices[0]
        : hasUnpriced && offerHasPositiveMrp(canonical)
          ? roundVariantMrp(canonical.price)
          : null;

    for (const row of cluster) {
      const next = {
        variant_key: variantKey,
        variant_asin: variantAsin
      };
      if (productVariantId) next.product_variant_id = productVariantId;
      const keyChanged = String(row?.variant_key || '').trim() !== variantKey;
      const asinChanged =
        String(row?.variant_asin || '').trim().toUpperCase() !== String(variantAsin).toUpperCase();
      const pvChanged =
        Boolean(productVariantId) &&
        String(row?.product_variant_id || '') !== String(productVariantId);
      if (!keyChanged && !asinChanged && !pvChanged) continue;
      patches.push({
        id: row.id,
        from: {
          variant_key: row.variant_key || null,
          variant_asin: row.variant_asin || null,
          product_variant_id: row.product_variant_id || null,
          price: row.price
        },
        to: next,
        canonicalMrp
      });
    }
  }

  return patches;
}

async function remapBcovVariantAsin(supabase, fromAsin, toAsin) {
  const from = String(fromAsin || '').trim();
  const to = String(toAsin || '').trim();
  if (!supabase || !from || !to || from === to) return;
  const { error } = await supabase
    .from('supplier_bcov_levels')
    .update({ variant_asin: to })
    .eq('variant_asin', from);
  if (error && !/does not exist|schema cache/i.test(String(error.message || ''))) {
    console.warn('[variant coalesce] bcov remap failed:', from, '→', to, error.message || error);
  }
}

export async function applyCatalogVariantIdentityPatches(supabase, patches = [], { productId } = {}) {
  const applied = [];
  const mrpByKey = new Map();

  for (const patch of patches || []) {
    if (!patch?.id || !patch?.to) continue;
    const { error } = await supabase
      .from('supplier_products')
      .update({
        ...patch.to,
        updated_at: new Date().toISOString()
      })
      .eq('id', patch.id);
    if (error) {
      console.warn('[variant coalesce] offer update failed:', patch.id, error.message || error);
      continue;
    }
    await remapBcovVariantAsin(supabase, patch.from?.variant_asin, patch.to.variant_asin);
    applied.push(patch);
    const mrp = roundVariantMrp(patch.canonicalMrp);
    if (mrp != null && mrp > 0 && patch.to.variant_key) {
      mrpByKey.set(patch.to.variant_key, mrp);
    }
  }

  if (productId) {
    for (const [variantKey, mrp] of mrpByKey.entries()) {
      try {
        await propagateVariantMrpToAllOffers(supabase, { productId, variantKey, mrp });
      } catch (error) {
        console.warn('[variant coalesce] MRP propagate failed:', variantKey, error?.message || error);
      }
    }
  }

  return applied;
}

export async function coalesceSameCatalogVariantIdentitiesForProduct(
  supabase,
  { productId, parentAsin = '', catalogSpecs = {}, offers = null } = {}
) {
  const pid = String(productId || '').trim();
  if (!supabase || !pid) return { patches: [], applied: [] };

  let offerRows = offers;
  if (!Array.isArray(offerRows)) {
    const { data, error } = await supabase
      .from('supplier_products')
      .select(
        'id, product_id, supplier_id, outlet_id, price, status, is_active, variant_key, variant_asin, product_variant_id, attributes, created_at, updated_at'
      )
      .eq('product_id', pid)
      .neq('status', 'rejected');
    if (error) {
      console.warn('[variant coalesce] load offers failed:', pid, error.message || error);
      return { patches: [], applied: [] };
    }
    offerRows = data || [];
  }

  const patches = planCatalogVariantIdentityCoalesce({
    parentAsin,
    catalogSpecs,
    offers: offerRows
  });
  if (!patches.length) return { patches, applied: [] };

  const applied = await applyCatalogVariantIdentityPatches(supabase, patches, { productId: pid });
  return { patches, applied };
}

export async function coalesceSplitVariantIdentitiesForProducts(supabase, products = [], offersByProductId = new Map()) {
  const summary = { products: 0, patchedOffers: 0 };
  if (!supabase) return summary;

  for (const product of products || []) {
    const productId = String(product?.id || '').trim();
    if (!productId) continue;
    const offers = offersByProductId.get(productId) || [];
    const distinctAsins = new Set(
      offers.map((row) => String(row?.variant_asin || '').trim().toUpperCase()).filter(Boolean)
    );
    const distinctKeys = new Set(
      offers.map((row) => String(row?.variant_key || '').trim()).filter(Boolean)
    );
    if (distinctAsins.size <= 1 && distinctKeys.size <= 1) continue;

    const { applied } = await coalesceSameCatalogVariantIdentitiesForProduct(supabase, {
      productId,
      parentAsin: product.asin || '',
      catalogSpecs: product.specifications || {},
      offers
    });
    if (!applied.length) continue;
    summary.products += 1;
    summary.patchedOffers += applied.length;

    const patchedById = new Map(applied.map((patch) => [patch.id, patch]));
    const mrpByKey = new Map();
    for (const patch of applied) {
      if (patch.to?.variant_key && patch.canonicalMrp != null && patch.canonicalMrp > 0) {
        mrpByKey.set(patch.to.variant_key, patch.canonicalMrp);
      }
    }
    offersByProductId.set(
      productId,
      offers.map((row) => {
        const patch = patchedById.get(row.id);
        const merged = patch ? { ...row, ...patch.to } : row;
        const key = String(merged.variant_key || '').trim();
        const mrp = mrpByKey.get(key);
        if (mrp != null && mrp > 0 && !(Number(merged.price) > 0)) {
          return { ...merged, price: mrp };
        }
        return merged;
      })
    );
  }

  return summary;
}
