import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getApiUrl } from '../config/api';
import {
  Network,
  Sparkles,
  Save,
  Trash2,
  Plus,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  Layers,
  GitBranch,
  AlertCircle,
  CheckCircle2,
  Package
} from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import './AdminDashboard.css';
import './AdminSupplyChain.css';

const ROLE_OPTIONS = [
  { value: 'manufacturer', label: 'Manufacturer (MGF)', short: 'MGF' },
  { value: 'stockist', label: 'Stockist', short: 'STK' },
  { value: 'regional_distributor', label: 'Regional Distributor', short: 'REG' },
  { value: 'local_distributor', label: 'Local Distributor', short: 'LOC' },
  { value: 'dealer', label: 'Dealer', short: 'DLR' },
  { value: 'retailer', label: 'Retailer', short: 'RTL' }
];

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('token')}`,
  'Content-Type': 'application/json'
});

const AdminSupplyChain = ({ user }) => {
  const [brands, setBrands] = useState([]);
  const [brandInput, setBrandInput] = useState('');
  const [productHint, setProductHint] = useState('');
  const [extraContext, setExtraContext] = useState('');
  const [summary, setSummary] = useState('');
  const [stages, setStages] = useState([]);
  const [definitionId, setDefinitionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [pendingAiMark, setPendingAiMark] = useState(false);
  const [message, setMessage] = useState(null);
  /** DB spelling for the loaded row — same brand, one saved chain only */
  const [canonicalBrandName, setCanonicalBrandName] = useState('');
  const loadDefinitionSeq = useRef(0);

  const stats = useMemo(() => {
    const total = brands.length;
    const defined = brands.filter((c) => c.hasDefinition).length;
    return { total, defined };
  }, [brands]);

  const currentBrandMeta = useMemo(() => {
    const q = brandInput.trim().toLowerCase();
    if (!q) return null;
    return brands.find((c) => c.name.toLowerCase() === q) || null;
  }, [brandInput, brands]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/admin/supply-chain/brands'), { headers: authHeaders() });
      const data = await res.json();
      if (data.status === 'success') {
        setBrands(data.categories || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadDefinition = useCallback(async (name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setSummary('');
      setStages([]);
      setDefinitionId(null);
      setCanonicalBrandName('');
      return;
    }
    const seq = ++loadDefinitionSeq.current;
    try {
      const enc = encodeURIComponent(trimmed);
      const res = await fetch(getApiUrl(`/api/admin/supply-chain/definitions/by-name/${enc}`), {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json();
      if (seq !== loadDefinitionSeq.current) return;

      if (data.status === 'success' && data.definition) {
        const d = data.definition;
        setDefinitionId(d.id);
        setSummary(d.summary || '');
        setStages(Array.isArray(d.stages) ? d.stages : []);
        setPendingAiMark(false);
        const canon = (d.category_name || '').trim();
        setCanonicalBrandName(canon);
        if (canon && canon.toLowerCase() === trimmed.toLowerCase()) {
          setBrandInput(canon);
        }
      } else {
        setDefinitionId(null);
        setSummary('');
        setStages([]);
        setPendingAiMark(false);
        setCanonicalBrandName('');
      }
    } catch (e) {
      console.error(e);
      if (seq === loadDefinitionSeq.current) {
        setCanonicalBrandName('');
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadCategories();
      setLoading(false);
    })();
  }, [loadCategories]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (brandInput.trim()) {
        loadDefinition(brandInput);
      } else {
        loadDefinitionSeq.current += 1;
        setDefinitionId(null);
        setSummary('');
        setStages([]);
        setPendingAiMark(false);
        setCanonicalBrandName('');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [brandInput, loadDefinition]);

  const handleSuggestGemini = async () => {
    const brand = brandInput.trim();
    if (!brand) {
      setMessage({ type: 'error', text: 'Enter or select a brand first.' });
      return;
    }
    if (
      definitionId &&
      !pendingAiMark &&
      !window.confirm(
        'This brand already has a saved supply chain. Gemini will replace the summary and stages below (nothing changes in the database until you click Save). Continue?'
      )
    ) {
      return;
    }
    setSuggesting(true);
    setMessage(null);
    try {
      const res = await fetch(getApiUrl('/api/admin/supply-chain/suggest-gemini'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          brandName: brand,
          productName: productHint.trim() || undefined,
          extraContext: extraContext.trim() || undefined
        })
      });
      const data = await res.json();
      if (data.status !== 'success') {
        setMessage({ type: 'error', text: data.message || 'Suggestion failed' });
        return;
      }
      setSummary(data.summary || '');
      setStages(data.stages || []);
      setPendingAiMark(true);
      setMessage({
        type: 'success',
        text: 'Gemini proposed a chain. Review stages below, adjust if needed, then save.'
      });
    } catch (e) {
      setMessage({ type: 'error', text: e.message || 'Request failed' });
    } finally {
      setSuggesting(false);
    }
  };

  const handleSave = async () => {
    const brand = brandInput.trim();
    if (!brand) {
      setMessage({ type: 'error', text: 'Brand name is required.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(getApiUrl('/api/admin/supply-chain/definitions'), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          brandName: brand,
          summary,
          stages,
          markAsAiSuggested: pendingAiMark
        })
      });
      const data = await res.json();
      if (data.status !== 'success') {
        setMessage({ type: 'error', text: data.message || 'Save failed' });
        return;
      }
      const def = data.definition;
      setDefinitionId(def?.id || null);
      setPendingAiMark(false);
      if (def?.category_name) {
        setBrandInput(def.category_name.trim());
        setCanonicalBrandName(def.category_name.trim());
      }
      setMessage({ type: 'success', text: 'Definition saved. It will be used for this brand flow.' });
      loadCategories();
    } catch (e) {
      setMessage({ type: 'error', text: e.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!definitionId) {
      setMessage({ type: 'error', text: 'No saved definition for this brand.' });
      return;
    }
    if (!window.confirm('Remove the saved supply chain for this brand?')) return;
    try {
      const res = await fetch(getApiUrl(`/api/admin/supply-chain/definitions/${definitionId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json();
      if (data.status !== 'success') {
        setMessage({ type: 'error', text: data.message || 'Delete failed' });
        return;
      }
      setSummary('');
      setStages([]);
      setDefinitionId(null);
      setCanonicalBrandName('');
      setMessage({ type: 'success', text: 'Definition removed.' });
      loadCategories();
    } catch (e) {
      setMessage({ type: 'error', text: e.message || 'Delete failed' });
    }
  };

  const updateStage = (index, field, value) => {
    setStages((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addStage = () => {
    setStages((prev) => [...prev, { role: 'manufacturer', roleLabel: 'Manufacturer (MGF)', notes: '' }]);
  };

  const removeStage = (index) => {
    setStages((prev) => prev.filter((_, i) => i !== index));
  };

  const moveStage = (index, dir) => {
    setStages((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const onRoleChange = (index, value) => {
    const label = ROLE_OPTIONS.find((o) => o.value === value)?.label || value;
    setStages((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], role: value, roleLabel: label };
      return next;
    });
  };

  if (loading) {
    return (
      <div className="admin-container">
        <div className="sc-loading-screen">
          <div className="spinner" />
          <p>Loading supply chain…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="sc-page">
        <header className="admin-header sc-hero">
          <div className="sc-title-row">
            <div className="sc-title-block">
              <div className="sc-eyebrow">
                <Layers size={14} aria-hidden />
                Catalog reference
              </div>
              <h1>
                <span className="sc-title-icon" aria-hidden>
                  <Network size={26} strokeWidth={1.75} />
                </span>
                Supply chain
              </h1>
              <p className="sc-subtitle">
                Map a typical upstream → downstream flow per brand. Use AI when you are unsure, then curate and
                save. Matches supplier roles in Profile (MGF through Retailer).
              </p>
            </div>
            <div className="admin-actions">
              <AdminNotifications />
              <button type="button" className="btn-refresh" onClick={loadCategories} title="Reload brand list">
                <RefreshCw size={16} />
                Refresh
              </button>
              <div className="admin-user-info">
                <span>{user?.name}</span>
                <div className="admin-badge">Admin</div>
              </div>
            </div>
          </div>
        </header>

        <div className="sc-stats-strip" aria-label="Catalog overview">
          <div className="sc-stat-pill">
            <div className="sc-stat-pill__icon sc-stat-pill__icon--slate">
              <Package size={20} strokeWidth={1.75} />
            </div>
            <div className="sc-stat-pill__body">
              <div className="sc-stat-pill__value">{stats.total}</div>
              <div className="sc-stat-pill__label">Catalog brands</div>
            </div>
          </div>
          <div className="sc-stat-pill">
            <div className="sc-stat-pill__icon sc-stat-pill__icon--emerald">
              <CheckCircle2 size={20} strokeWidth={1.75} />
            </div>
            <div className="sc-stat-pill__body">
              <div className="sc-stat-pill__value">{stats.defined}</div>
              <div className="sc-stat-pill__label">Chains defined</div>
            </div>
          </div>
          <div className="sc-stat-pill">
            <div className="sc-stat-pill__icon sc-stat-pill__icon--amber">
              <GitBranch size={20} strokeWidth={1.75} />
            </div>
            <div className="sc-stat-pill__body">
              <div className="sc-stat-pill__value">
                {brandInput.trim() ? definitionId ? 'Saved' : 'Draft' : '—'}
              </div>
              <div className="sc-stat-pill__label">Current brand</div>
            </div>
          </div>
          {definitionId && (
            <div className="sc-stat-pill">
              <div className="sc-stat-pill__icon sc-stat-pill__icon--violet">
                <Layers size={20} strokeWidth={1.75} />
              </div>
              <div className="sc-stat-pill__body">
                <div className="sc-stat-pill__value" style={{ fontSize: '0.8125rem', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                  {definitionId.slice(0, 8)}…
                </div>
                <div className="sc-stat-pill__label">Record id</div>
              </div>
            </div>
          )}
        </div>

        {message && (
          <div
            className={`sc-alert ${message.type === 'error' ? 'sc-alert--error' : 'sc-alert--success'}`}
            role="status"
          >
            {message.type === 'error' ? (
              <AlertCircle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
            ) : (
              <CheckCircle2 size={20} style={{ flexShrink: 0, marginTop: 2 }} />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {definitionId && canonicalBrandName && (
          <div className="sc-saved-banner" role="status">
            <CheckCircle2 size={22} className="sc-saved-banner__icon" aria-hidden />
            <div>
              <strong>Saved chain for this brand only</strong>
              <p>
                You are viewing the single saved definition for <span className="sc-saved-banner__cat">{canonicalBrandName}</span>.
                Another brand has its own separate saved chain. Switch the brand field above to edit a different one.
              </p>
            </div>
          </div>
        )}

        <div className="sc-grid sc-grid--split">
          <section className="sc-card" aria-labelledby="sc-input-heading">
            <div className="sc-card__head">
              <h2 id="sc-input-heading">
                <GitBranch size={18} />
                Brand &amp; AI context
              </h2>
              <p>We’ll pull matching catalog brands as you type. You can enter a new name too.</p>
            </div>
            <div className="sc-card__body">
              <div className="sc-field">
                <label className="sc-section-label" htmlFor="sc-category">
                  Brand
                </label>
                <input
                  id="sc-category"
                  className="sc-input"
                  list="supply-chain-cat-list"
                  placeholder="e.g. Asian Paints, Ultratech, Berger"
                  value={brandInput}
                  onChange={(e) => setBrandInput(e.target.value)}
                  autoComplete="off"
                />
                <datalist id="supply-chain-cat-list">
                  {brands.map((c) => (
                    <option key={c.name} value={c.name} />
                  ))}
                </datalist>
                {currentBrandMeta && (
                  <p className="sc-hint">
                    {currentBrandMeta.hasDefinition
                      ? 'This name has a saved definition — it will load automatically.'
                      : 'No saved chain yet for this catalog name.'}
                  </p>
                )}
              </div>

              <div className="sc-field">
                <label className="sc-section-label" htmlFor="sc-product">
                  Example product <span className="sc-label-muted">(optional)</span>
                </label>
                <input
                  id="sc-product"
                  className="sc-input"
                  placeholder="e.g. OPC 53 Grade cement, 4 sq mm FR wire"
                  value={productHint}
                  onChange={(e) => setProductHint(e.target.value)}
                />
              </div>

              <div className="sc-field">
                <label className="sc-section-label" htmlFor="sc-context">
                  Extra context for AI <span className="sc-label-muted">(optional)</span>
                </label>
                <textarea
                  id="sc-context"
                  className="sc-textarea"
                  placeholder="Region, import vs domestic, project type…"
                  value={extraContext}
                  onChange={(e) => setExtraContext(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="sc-actions">
                <button
                  type="button"
                  className="sc-btn-gemini"
                  onClick={handleSuggestGemini}
                  disabled={suggesting || !brandInput.trim()}
                >
                  <Sparkles size={18} />
                  {suggesting ? 'Contacting Gemini…' : 'Suggest with Gemini'}
                </button>
                {pendingAiMark && <span className="sc-badge sc-badge--draft sc-badge--inline">Unsaved AI draft</span>}
              </div>
            </div>
          </section>

          <section className="sc-card sc-card--subtle" aria-labelledby="sc-preview-heading">
            <div className="sc-card__head">
              <h2 id="sc-preview-heading">
                <Package size={18} />
                Role ladder
              </h2>
              <p>Canonical order from upstream to downstream. Your saved chain can use a subset.</p>
            </div>
            <div className="sc-card__body">
              <ul className="sc-role-ladder" role="list">
                {ROLE_OPTIONS.map((o) => (
                  <li key={o.value} className="sc-role-step" role="listitem">
                    <div className="sc-role-step__inner">
                      <span className="sc-role-step__abbr">{o.short}</span>
                      <span>{o.label}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        <section className="sc-card sc-chain-card" aria-labelledby="sc-chain-heading">
          <div className="sc-card__head">
            <h2 id="sc-chain-heading">Typical chain &amp; summary</h2>
            <p>Edit the narrative and each stage. Order must stay manufacturer → retailer with no gaps in sequence logic.</p>
          </div>
          <div className="sc-card__body">
            <div className="sc-field sc-summary-field">
              <label className="sc-section-label" htmlFor="sc-summary">
                Market summary
              </label>
              <textarea
                id="sc-summary"
                className="sc-textarea"
                placeholder="Short overview of how this brand usually flows (regions, channels, regulation…)."
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={4}
              />
            </div>

            {stages.length === 0 ? (
              <div className="sc-empty">
                <div className="sc-empty__icon">
                  <GitBranch size={28} strokeWidth={1.5} />
                </div>
                <p>No stages yet. Run Gemini from the left card or add stages manually below.</p>
              </div>
            ) : (
              <ul className="sc-timeline">
                {stages.map((stage, index) => (
                  <li key={`stage-${index}`} className="sc-timeline-item">
                    <span className="sc-timeline-node">{index + 1}</span>
                    <div className="sc-stage-panel">
                      <select
                        className="sc-select"
                        aria-label={`Role for stage ${index + 1}`}
                        value={stage.role || ''}
                        onChange={(e) => onRoleChange(index, e.target.value)}
                      >
                        {ROLE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <div className="sc-stage-notes">
                        <input
                          type="text"
                          className="sc-input"
                          placeholder="Stage notes (optional)"
                          value={stage.notes || ''}
                          onChange={(e) => updateStage(index, 'notes', e.target.value)}
                        />
                      </div>
                      <div className="sc-stage-tools">
                        <button
                          type="button"
                          className="sc-icon-btn"
                          title="Move up"
                          disabled={index === 0}
                          onClick={() => moveStage(index, -1)}
                        >
                          <ChevronUp size={18} />
                        </button>
                        <button
                          type="button"
                          className="sc-icon-btn"
                          title="Move down"
                          disabled={index === stages.length - 1}
                          onClick={() => moveStage(index, 1)}
                        >
                          <ChevronDown size={18} />
                        </button>
                        <button
                          type="button"
                          className="sc-icon-btn sc-icon-btn--danger"
                          title="Remove stage"
                          onClick={() => removeStage(index)}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="sc-add-stage-wrap">
              <button type="button" className="sc-btn-add-stage" onClick={addStage}>
                <Plus size={18} strokeWidth={2} />
                Add stage
              </button>
            </div>

            <div className="sc-footer-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={handleSave}
                disabled={saving || !brandInput.trim()}
              >
                <Save size={18} />
                {saving ? 'Saving…' : 'Save definition'}
              </button>
              <button type="button" className="btn-secondary" onClick={handleDelete} disabled={!definitionId}>
                <Trash2 size={18} />
                Delete saved
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminSupplyChain;
