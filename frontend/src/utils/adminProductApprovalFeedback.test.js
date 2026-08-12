import { describe, expect, it } from 'vitest';
import { formatAdminProductApprovalFailureMessage } from './adminProductApprovalFeedback.js';

describe('formatAdminProductApprovalFailureMessage', () => {
  it('includes heading and missing requirement bullets', () => {
    const text = formatAdminProductApprovalFailureMessage({
      message: 'Complete before approval: HSN code, GST rates.',
      missingRequirements: [
        { id: 'gst_hsn', message: 'Set and save a valid HSN code (4–8 digits).' },
        { id: 'gst_rates', message: 'Set and save IGST, CGST, and SGST rates before approval.' }
      ]
    });
    expect(text).toContain('Complete before approval: HSN code, GST rates.');
    expect(text).toContain('• Set and save a valid HSN code (4–8 digits).');
    expect(text).toContain('• Set and save IGST, CGST, and SGST rates before approval.');
  });

  it('returns fallback when payload is empty', () => {
    expect(formatAdminProductApprovalFailureMessage({})).toMatch(/failed/i);
  });
});
