/**
 * Build a clear admin-facing message when product approval is blocked or fails.
 * Prefer API `message` + `missingRequirements`, then local readiness rows.
 */
export function formatAdminProductApprovalFailureMessage({
  message = '',
  missingRequirements = [],
  fallback = 'Product approval failed. Check description, GST, and specifications, then try again.'
} = {}) {
  const lines = [];
  const heading = String(message || '').trim();
  if (heading) lines.push(heading);

  const rows = Array.isArray(missingRequirements) ? missingRequirements : [];
  for (const row of rows) {
    if (typeof row === 'string') {
      const text = row.trim();
      if (text) lines.push(`• ${text}`);
      continue;
    }
    const item = String(row?.message || row?.label || '').trim();
    if (item) lines.push(`• ${item}`);
  }

  if (lines.length === 0) return String(fallback || '').trim();
  return lines.join('\n');
}

export async function readAdminApprovalErrorPayload(response) {
  if (!response) {
    return {
      message: 'Product approval failed. No response from server.',
      missingRequirements: []
    };
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  const message =
    String(data?.message || data?.error || '').trim() ||
    `Product approval failed (${response.status || 'error'}).`;
  return {
    message,
    missingRequirements: Array.isArray(data?.missingRequirements) ? data.missingRequirements : [],
    code: data?.code || null,
    raw: data
  };
}
