export async function enrichItemVendorsWithLatestScorecards({ supabase, itemVendors }) {
  const supplierIds = Array.from(
    new Set(
      Object.values(itemVendors)
        .flatMap((vendors) => (vendors || []).map((v) => v?.id))
        .filter(Boolean)
    )
  );

  if (supplierIds.length === 0) return itemVendors;

  const { data: scoreRows } = await supabase
    .from('vendor_scorecards')
    .select('supplier_id, week_start, week_end, score, fill_rate, avg_lead_time_hours')
    .in('supplier_id', supplierIds)
    .order('week_start', { ascending: false });

  const latestBySupplier = new Map();
  for (const row of scoreRows || []) {
    if (!latestBySupplier.has(row.supplier_id)) {
      latestBySupplier.set(row.supplier_id, row);
    }
  }

  Object.keys(itemVendors).forEach((itemId) => {
    itemVendors[itemId] = (itemVendors[itemId] || []).map((vendor) => ({
      ...vendor,
      scorecard: latestBySupplier.get(vendor.id) || null
    }));
  });

  return itemVendors;
}
