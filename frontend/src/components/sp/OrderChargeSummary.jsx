import React from 'react';
import { resolveOrderChargeBreakdown } from '../../utils/orderChargeBreakdown';
import {
  formatGstBasisLabel,
  formatGstTaxTypeLabel,
  gstBreakdownRows
} from '../../utils/gstDisplay';

function formatInr(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function GstDetails({ gstSummary, compact = false }) {
  const basis = formatGstBasisLabel(gstSummary);
  const rows = gstBreakdownRows(gstSummary);
  if (!rows.length && !basis) return null;

  if (compact) {
    return (
      <>
        {basis ? (
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#64748b' }}>{basis}</p>
        ) : null}
        {gstSummary?.taxType ? (
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.82rem', color: '#64748b' }}>
            {formatGstTaxTypeLabel(gstSummary.taxType)}
          </p>
        ) : null}
        {rows.map((row) => (
          <p key={row.label} style={{ margin: '0.2rem 0 0' }}>
            <strong>{row.label}:</strong> {formatInr(row.amount)}
          </p>
        ))}
      </>
    );
  }

  return (
    <>
      {basis ? (
        <tr>
          <td colSpan="4" style={{ fontSize: '0.82rem', color: '#64748b', paddingTop: '0.35rem' }}>
            {basis}
            {gstSummary?.taxType ? ` · ${formatGstTaxTypeLabel(gstSummary.taxType)}` : ''}
          </td>
        </tr>
      ) : null}
      {rows.map((row) => (
        <tr key={row.label}>
          <td colSpan="3">
            <strong>{row.label}</strong>
          </td>
          <td>
            <strong>{formatInr(row.amount)}</strong>
          </td>
        </tr>
      ))}
    </>
  );
}

export default function OrderChargeSummary({ order, compact = false }) {
  const breakdown = resolveOrderChargeBreakdown(order);
  const gstSummary = breakdown.gstSummary;

  if (compact) {
    return (
      <div style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: '#334155' }}>
        <p style={{ margin: 0 }}>
          <strong>Taxable value:</strong> {formatInr(breakdown.productSubtotal)}
        </p>
        <GstDetails gstSummary={gstSummary} compact />
        {breakdown.gstAmount > 0 ? (
          <p style={{ margin: '0.2rem 0 0' }}>
            <strong>GST (included in MRP):</strong> {formatInr(breakdown.gstAmount)}
          </p>
        ) : null}
        <p style={{ margin: '0.2rem 0 0' }}>
          <strong>Product total (MRP):</strong> {formatInr(breakdown.productsInclGst)}
        </p>
        {breakdown.transportAmount > 0 ? (
          <p style={{ margin: '0.2rem 0 0' }}>
            <strong>Transport:</strong> {formatInr(breakdown.transportAmount)}
          </p>
        ) : null}
        <p style={{ margin: '0.35rem 0 0', fontWeight: 700, color: '#0f172a' }}>
          <strong>Combined total:</strong> {formatInr(breakdown.combinedTotal)}
        </p>
      </div>
    );
  }

  return (
    <table className="order-items-table" style={{ marginTop: '0.75rem' }}>
      <tbody>
        <tr>
          <td colSpan="3">
            <strong>Taxable value</strong>
          </td>
          <td>
            <strong>{formatInr(breakdown.productSubtotal)}</strong>
          </td>
        </tr>
        <GstDetails gstSummary={gstSummary} />
        {breakdown.gstAmount > 0 ? (
          <tr>
            <td colSpan="3">
              <strong>GST (included in MRP)</strong>
            </td>
            <td>
              <strong>{formatInr(breakdown.gstAmount)}</strong>
            </td>
          </tr>
        ) : null}
        <tr>
          <td colSpan="3">
            <strong>Product total (MRP)</strong>
          </td>
          <td>
            <strong>{formatInr(breakdown.productsInclGst)}</strong>
          </td>
        </tr>
        {breakdown.transportAmount > 0 ? (
          <tr>
            <td colSpan="3">
              <strong>Transport</strong>
            </td>
            <td>
              <strong>{formatInr(breakdown.transportAmount)}</strong>
            </td>
          </tr>
        ) : null}
        <tr>
          <td colSpan="3">
            <strong>Combined total</strong>
          </td>
          <td>
            <strong>{formatInr(breakdown.combinedTotal)}</strong>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
