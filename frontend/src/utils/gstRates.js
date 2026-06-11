export const IGST_OPTIONS = ['0', '5', '12', '18', '28'];
export const CGST_SGST_OPTIONS = ['0', '2.5', '6', '9', '14'];

/** IGST = CGST + SGST and CGST = SGST for intra-state GST splits. */
export function deriveCgstSgstFromIgst(igstRate) {
  const igst = parseFloat(igstRate);
  if (!Number.isFinite(igst)) {
    return { cgst_rate: '', sgst_rate: '' };
  }

  const half = igst / 2;
  const matched = CGST_SGST_OPTIONS.find((opt) => Math.abs(parseFloat(opt) - half) < 0.001);
  const halfRate = matched || (Number.isInteger(half) ? String(half) : String(half));

  return {
    cgst_rate: halfRate,
    sgst_rate: halfRate
  };
}

export function applyIgstToTaxFields(prev, igstRate) {
  const { cgst_rate, sgst_rate } = deriveCgstSgstFromIgst(igstRate);
  return {
    ...prev,
    igst_rate: igstRate,
    cgst_rate,
    sgst_rate
  };
}
