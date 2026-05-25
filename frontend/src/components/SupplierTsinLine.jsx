/** Parent + variant TSIN from supplier offer (read-only). */
export default function SupplierTsinLine({ asin, variantAsin, style = {} }) {
  const parent = String(asin || '').trim();
  const variant = String(variantAsin || '').trim();
  if (!parent && !variant) return null;

  const mono = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#0f172a'
  };

  return (
    <div
      style={{
        fontSize: '0.78rem',
        color: '#475569',
        marginTop: '0.25rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem 0.85rem',
        lineHeight: 1.45,
        ...style
      }}
    >
      {parent ? (
        <span>
          <strong style={{ fontWeight: 700, color: '#334155' }}>TSIN:</strong>{' '}
          <span style={mono}>{parent}</span>
        </span>
      ) : null}
      {variant ? (
        <span>
          <strong style={{ fontWeight: 700, color: '#334155' }}>Variant TSIN:</strong>{' '}
          <span style={mono}>{variant}</span>
        </span>
      ) : null}
    </div>
  );
}
