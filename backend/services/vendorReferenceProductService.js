export async function loadReferenceProductForItem({ supabase, productId }) {
  if (!productId) return null;

  const { data: refRow, error: refErr } = await supabase
    .from('products')
    .select(`
      *,
      supplier:users!products_supplier_id_fkey (id, name, company, email, phone, address, profile)
    `)
    .eq('id', productId)
    .in('status', ['approved', 'pending'])
    .maybeSingle();

  if (refErr) {
    return { error: refErr, referenceProduct: null };
  }

  return { error: null, referenceProduct: refRow || null };
}
