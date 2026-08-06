export function formatGstTaxTypeLabel(taxType) {
  if (taxType === 'IGST') return 'IGST (inter-state)';
  if (taxType === 'CGST_SGST') return 'CGST + SGST (same state)';
  if (taxType === 'MIXED') return 'IGST + CGST/SGST (mixed)';
  return 'No GST';
}

export function formatGstBasisLabel(gstSummary) {
  if (!gstSummary) return null;
  const supplier = String(gstSummary.supplierState || '').trim();
  const customer = String(
    gstSummary.placeOfSupplyState || gstSummary.billingState || ''
  ).trim();
  if (!supplier && !customer) return null;
  const parts = [];
  if (supplier) parts.push(`Supplier: ${supplier}`);
  if (customer) parts.push(`Place of supply: ${customer}`);
  return parts.join(' · ');
}

export function gstBreakdownRows(gstSummary) {
  if (!gstSummary) return [];
  const rows = [];
  if (Number(gstSummary.igstAmount) > 0) {
    rows.push({ label: 'IGST', amount: Number(gstSummary.igstAmount) });
  }
  if (Number(gstSummary.cgstAmount) > 0) {
    rows.push({ label: 'CGST', amount: Number(gstSummary.cgstAmount) });
  }
  if (Number(gstSummary.sgstAmount) > 0) {
    rows.push({ label: 'SGST', amount: Number(gstSummary.sgstAmount) });
  }
  if (!rows.length && Number(gstSummary.taxAmount) > 0) {
    rows.push({ label: 'GST', amount: Number(gstSummary.taxAmount) });
  }
  return rows;
}
