export function normalizeBoqProductRequestName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function buildBoqProductRequestKey({ boqId, boqItemId, name }) {
  const boqPart = boqId ? String(boqId).trim() : 'draft';
  const itemPart =
    boqItemId != null && String(boqItemId).trim() !== ''
      ? `item:${String(boqItemId).trim()}`
      : `name:${normalizeBoqProductRequestName(name)}`;
  return `${boqPart}:${itemPart}`;
}

export async function findExistingBoqProductRequest(db, userId, payload) {
  const requestKey = buildBoqProductRequestKey(payload);
  const { data, error } = await db
    .from('product_requests')
    .select('id, created_at, normalized_input')
    .eq('requested_by', userId)
    .eq('source', 'boq')
    .filter('normalized_input->>requestKey', 'eq', requestKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function recordBoqProductRequest(db, userId, payload) {
  const {
    name,
    category,
    unit,
    description,
    brand,
    boqId,
    boqItemId
  } = payload;
  const requestKey = buildBoqProductRequestKey({ boqId, boqItemId, name });

  const { data, error } = await db
    .from('product_requests')
    .insert({
      requested_by: userId,
      source: 'boq',
      status: 'new',
      category: String(category || 'other').trim().toLowerCase(),
      normalized_input: {
        requestKey,
        name: String(name || '').trim(),
        description: String(description || '').trim(),
        brand: String(brand || '').trim(),
        unit: String(unit || 'nos').trim().toLowerCase(),
        boqId: boqId || null,
        boqItemId: boqItemId != null ? String(boqItemId) : null
      }
    })
    .select('id')
    .single();

  if (error) throw error;
  return data;
}
