import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Package,
  Percent
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

/** Dedupe roles and sort upstream → downstream before save (matches backend). */
function normalizeStagesForSave(rawStages) {
  const byRole = new Map();
  for (const s of rawStages || []) {
    const role = s?.role;
    if (!role) continue;
    const opt = ROLE_OPTIONS.find((o) => o.value === role);
    if (!opt) continue;
    if (!byRole.has(role)) {
      byRole.set(role, {
        role,
        roleLabel: opt.label,
        notes: typeof s?.notes === 'string' ? s.notes : ''
      });
    }
  }
  return ROLE_OPTIONS.map((o) => o.value)
    .filter((r) => byRole.has(r))
    .map((r) => byRole.get(r));
}

function normalizeBrandKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  const [feeRules, setFeeRules] = useState([]);
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeSaving, setFeeSaving] = useState(false);
  const feeScope = 'brand';
  const [feeBrandSelection, setFeeBrandSelection] = useState('');
  const [feeBrandRoles, setFeeBrandRoles] = useState([]);
  const [feeBrandRolesLoading, setFeeBrandRolesLoading] = useState(false);
  const [feeDraft, setFeeDraft] = useState([]);
  const [previewAmount, setPreviewAmount] = useState('10000');
  const [previewRole, setPreviewRole] = useState('dealer');
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

  const loadFeeRules = useCallback(async () => {
    try {
      setFeeLoading(true);
      const res = await fetch(getApiUrl('/api/admin/supply-chain/platform-fees'), {
        headers: authHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'success') {
        setFeeRules(Array.isArray(data.rules) ? data.rules : []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setFeeLoading(false);
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
        setStages(
          normalizeStagesForSave(Array.isArray(d.stages) ? d.stages : [])
        );
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
      await loadFeeRules();
      setLoading(false);
    })();
  }, [loadCategories, loadFeeRules]);

  const selectedFeeBrand = useMemo(() => {
    if (feeScope !== 'brand') return '';
    return String(feeBrandSelection || canonicalBrandName || brandInput || '').trim();
  }, [brandInput, canonicalBrandName, feeBrandSelection, feeScope]);

  const feeBrandOptions = useMemo(() => {
    const byKey = new Map();
    for (const entry of brands || []) {
      const name = String(entry?.name || '').trim();
      const key = normalizeBrandKey(name);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, name);
    }
    for (const row of feeRules || []) {
      const name = String(row?.brand_name || '').trim();
      const key = normalizeBrandKey(name);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, name);
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [brands, feeRules]);

  useEffect(() => {
    if (feeScope !== 'brand') return;
    if (String(feeBrandSelection || '').trim()) return;
    const fallback = String(canonicalBrandName || brandInput || '').trim();
    if (fallback) setFeeBrandSelection(fallback);
  }, [brandInput, canonicalBrandName, feeBrandSelection, feeScope]);

  useEffect(() => {
    if (feeScope !== 'brand') {
      setFeeBrandRoles([]);
      setFeeBrandRolesLoading(false);
      return;
    }
    const brand = String(selectedFeeBrand || '').trim();
    if (!brand) {
      setFeeBrandRoles([]);
      setFeeBrandRolesLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setFeeBrandRolesLoading(true);
        const enc = encodeURIComponent(brand);
        const res = await fetch(getApiUrl(`/api/admin/supply-chain/definitions/by-name/${enc}`), {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || data.status !== 'success' || !data.definition) {
          setFeeBrandRoles([]);
          return;
        }
        const normalizedStages = normalizeStagesForSave(
          Array.isArray(data.definition.stages) ? data.definition.stages : []
        );
        setFeeBrandRoles(normalizedStages.map((s) => s.role).filter(Boolean));
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setFeeBrandRoles([]);
        }
      } finally {
        if (!cancelled) setFeeBrandRolesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feeScope, selectedFeeBrand]);

  const feeRolesForMatrix = useMemo(() => {
    if (feeScope !== 'brand') return [];
    if (feeBrandRoles.length === 0) return [];
    const allowed = new Set(feeBrandRoles);
    return ROLE_OPTIONS.filter((opt) => allowed.has(opt.value));
  }, [feeBrandRoles, feeScope]);

  const feeBrandHint = useMemo(() => {
    if (feeScope !== 'brand' || !selectedFeeBrand) return null;
    if (feeBrandRolesLoading) {
      return {
        tone: 'info',
        text: `Loading saved supply-chain roles for ${selectedFeeBrand}...`
      };
    }
    if (feeBrandRoles.length > 0) {
      return {
        tone: 'success',
        text: `Using saved supply chain for ${selectedFeeBrand}. Only these roles are shown.`
      };
    }
    return {
      tone: 'warning',
      text: `No saved supply chain found for ${selectedFeeBrand}. Define and save supply chain first.`
    };
  }, [feeBrandRoles, feeBrandRolesLoading, feeScope, selectedFeeBrand]);

  useEffect(() => {
    const normalizedSelectedBrand = normalizeBrandKey(selectedFeeBrand);
    const next = feeRolesForMatrix.map((opt) => {
      const match = (feeRules || []).find((row) => {
        if (!row || row.supply_chain_role !== opt.value || row.is_active === false) return false;
        const rowBrand = normalizeBrandKey(row.normalized_brand || row.brand_name || '');
        if (feeScope === 'brand') return rowBrand && rowBrand === normalizedSelectedBrand;
        return !rowBrand;
      });
      return {
        role: opt.value,
        roleLabel: opt.label,
        id: match?.id || null,
        feeType: match?.fee_type || 'percentage',
        feeValue: Number(match?.fee_value || 0),
        isActive: match ? match.is_active !== false : true
      };
    });
    setFeeDraft(next);
  }, [feeRolesForMatrix, feeRules, feeScope, selectedFeeBrand]);

  useEffect(() => {
    if (!feeDraft.length) {
      setPreviewRole('');
      return;
    }
    if (!feeDraft.some((row) => row.role === previewRole)) {
      setPreviewRole(feeDraft[0].role);
    }
  }, [feeDraft, previewRole]);

  const feePreview = useMemo(() => {
    const amount = Number(previewAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      return {
        amount: 0,
        feeAmount: 0,
        supplierNet: 0,
        feeType: 'percentage',
        feeValue: 0,
        source: 'invalid_amount'
      };
    }

    const role = previewRole || feeDraft[0]?.role || '';
    if (!role) {
      return {
        amount,
        feeAmount: 0,
        supplierNet: amount,
        feeType: 'percentage',
        feeValue: 0,
        source: 'none'
      };
    }
    const wantedBrandKey = normalizeBrandKey(selectedFeeBrand);
    const activeRules = (feeRules || []).filter((row) => row && row.is_active !== false);
    const roleRules = activeRules.filter((row) => row.supply_chain_role === role);

    const brandRule =
      wantedBrandKey &&
      roleRules.find(
        (row) =>
          normalizeBrandKey(row.normalized_brand || row.brand_name || '') === wantedBrandKey
      );
    const fallbackDraft = (feeDraft || []).find((row) => row.role === role);
    const rule = brandRule || fallbackDraft || null;

    const feeType = rule?.fee_type || rule?.feeType || 'percentage';
    const feeValueRaw = Number(rule?.fee_value ?? rule?.feeValue ?? 0);
    const feeValue = Number.isFinite(feeValueRaw) ? feeValueRaw : 0;
    const feeAmount =
      feeType === 'fixed'
        ? Math.max(0, feeValue)
        : Math.max(0, Number(((amount * feeValue) / 100).toFixed(2)));
    const boundedFeeAmount = Math.min(amount, feeAmount);
    const supplierNet = Number((amount - boundedFeeAmount).toFixed(2));

    return {
      amount,
      feeAmount: boundedFeeAmount,
      supplierNet,
      feeType,
      feeValue,
      source: brandRule ? 'brand_role' : fallbackDraft ? 'draft' : 'none'
    };
  }, [feeDraft, feeRules, previewAmount, previewRole, selectedFeeBrand]);

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
      const stagesToSave = normalizeStagesForSave(stages);
      if (stagesToSave.length === 0) {
        setMessage({ type: 'error', text: 'Add at least one supply-chain stage before saving.' });
        return;
      }

      const res = await fetch(getApiUrl('/api/admin/supply-chain/definitions'), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          brandName: brand,
          summary,
          stages: stagesToSave,
          markAsAiSuggested: pendingAiMark
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') {
        setMessage({ type: 'error', text: data.message || 'Save failed' });
        return;
      }
      const def = data.definition;
      setDefinitionId(def?.id || null);
      setPendingAiMark(false);
      setStages(Array.isArray(def?.stages) ? def.stages : stagesToSave);
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

  const updateFeeDraft = (role, patch) => {
    setFeeDraft((prev) =>
      prev.map((row) => (row.role === role ? { ...row, ...patch } : row))
    );
  };

  const handleSaveFeeMatrix = async () => {
    if (feeScope === 'brand' && !selectedFeeBrand) {
      setMessage({ type: 'error', text: 'Select a brand before saving brand-specific fee matrix.' });
      return;
    }
    if ((feeDraft || []).length === 0) {
      setMessage({
        type: 'error',
        text: `No supply-chain roles available for ${selectedFeeBrand || 'this brand'}. Save the brand supply chain first.`
      });
      return;
    }
    const payloadRules = (feeDraft || []).map((row) => ({
      ...(row.id ? { id: row.id } : {}),
      brandName: feeScope === 'brand' ? selectedFeeBrand : null,
      supplyChainRole: row.role,
      feeType: row.feeType,
      feeValue: Number(row.feeValue || 0),
      isActive: Boolean(row.isActive),
      notes:
        feeScope === 'brand'
          ? `Brand-specific fee for ${selectedFeeBrand}`
          : ''
    }));
    try {
      setFeeSaving(true);
      const res = await fetch(getApiUrl('/api/admin/supply-chain/platform-fees'), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ rules: payloadRules })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') {
        setMessage({ type: 'error', text: data.message || 'Failed to save fee matrix' });
        return;
      }
      setMessage({
        type: 'success',
        text:
          feeScope === 'brand'
            ? `Saved platform fee matrix for ${selectedFeeBrand}.`
            : 'Saved global role-wise platform fee defaults.'
      });
      await loadFeeRules();
    } catch (e) {
      setMessage({ type: 'error', text: e.message || 'Failed to save fee matrix' });
    } finally {
      setFeeSaving(false);
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
    setStages((prev) => {
      const used = new Set((prev || []).map((s) => s.role).filter(Boolean));
      const nextOpt = ROLE_OPTIONS.find((o) => !used.has(o.value));
      if (!nextOpt) return prev;
      return [...prev, { role: nextOpt.value, roleLabel: nextOpt.label, notes: '' }];
    });
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
      return normalizeStagesForSave(next);
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
            <p>
              Edit the narrative and each stage. You can skip tiers (e.g. manufacturer → dealer → retailer). On save,
              stages are sorted upstream → downstream; duplicate roles are merged.
            </p>
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

        <section className="sc-card sc-fee-card" aria-labelledby="sc-fee-heading">
          <div className="sc-card__head">
            <h2 id="sc-fee-heading">
              <Percent size={18} />
              Platform fee matrix (dynamic)
            </h2>
            <p>
              Configure platform commission by supply chain level for each brand.
              The saved rate is deducted from every product and variant of that brand
              at payment time — percentage of each line, or the fixed INR amount per line.
            </p>
          </div>
          <div className="sc-card__body">
            <div className="sc-fee-topbar">
              <div className="sc-fee-brand-select">
                <label className="sc-section-label" htmlFor="sc-fee-brand-select">
                  Brand
                </label>
                <select
                  id="sc-fee-brand-select"
                  className="sc-select"
                  value={selectedFeeBrand}
                  onChange={(e) => setFeeBrandSelection(e.target.value)}
                >
                  <option value="">Select a brand</option>
                  {selectedFeeBrand && !feeBrandOptions.includes(selectedFeeBrand) && (
                    <option value={selectedFeeBrand}>{selectedFeeBrand}</option>
                  )}
                  {feeBrandOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sc-fee-meta">
                <span>
                  Brand: <strong>{selectedFeeBrand || 'Select a brand above'}</strong>
                </span>
              </div>
            </div>

            {feeBrandHint && (
              <div className={`sc-fee-brand-hint sc-fee-brand-hint--${feeBrandHint.tone}`} role="status">
                <strong>{feeBrandHint.text}</strong>
              </div>
            )}

            <div className="sc-fee-grid">
              <div className="sc-fee-grid__head">Supply chain role</div>
              <div className="sc-fee-grid__head">Fee type</div>
              <div className="sc-fee-grid__head">Fee value</div>
              <div className="sc-fee-grid__head">Active</div>

              {feeDraft.map((row) => (
                <Fragment key={row.role}>
                  <div className="sc-fee-grid__cell sc-fee-grid__role" key={`${row.role}-role`}>
                    {row.roleLabel}
                  </div>
                  <div className="sc-fee-grid__cell" key={`${row.role}-type`}>
                    <select
                      className="sc-select"
                      value={row.feeType}
                      onChange={(e) => updateFeeDraft(row.role, { feeType: e.target.value })}
                    >
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed">Fixed (INR)</option>
                    </select>
                  </div>
                  <div className="sc-fee-grid__cell" key={`${row.role}-value`}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="sc-input"
                      value={row.feeValue}
                      onChange={(e) => updateFeeDraft(row.role, { feeValue: e.target.value })}
                    />
                  </div>
                  <div className="sc-fee-grid__cell" key={`${row.role}-active`}>
                    <label className="sc-fee-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(row.isActive)}
                        onChange={(e) => updateFeeDraft(row.role, { isActive: e.target.checked })}
                      />
                      <span>{row.isActive ? 'Yes' : 'No'}</span>
                    </label>
                  </div>
                </Fragment>
              ))}
            </div>

            <div className="sc-fee-preview">
              <div className="sc-fee-preview__head">
                <h3>Fee preview calculator</h3>
                <p>Quickly test how much the platform keeps and supplier receives.</p>
              </div>
              <div className="sc-fee-preview__controls">
                <div className="sc-field">
                  <label className="sc-section-label">Order amount (INR)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="sc-input"
                    value={previewAmount}
                    onChange={(e) => setPreviewAmount(e.target.value)}
                  />
                </div>
                <div className="sc-field">
                  <label className="sc-section-label">Supply chain role</label>
                  <select
                    className="sc-select"
                    value={previewRole}
                    onChange={(e) => setPreviewRole(e.target.value)}
                    disabled={feeDraft.length === 0}
                  >
                    {feeDraft.length === 0 ? (
                      <option value="">No roles available</option>
                    ) : (
                      feeRolesForMatrix.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>
              <div className="sc-fee-preview__result">
                <div className="sc-fee-preview__pill">
                  <span>Rule source</span>
                  <strong>
                    {feePreview.source === 'brand_role'
                      ? `Brand + role (${selectedFeeBrand || 'current brand'})`
                      : feePreview.source === 'draft'
                          ? 'Current unsaved draft'
                          : 'No rule'}
                  </strong>
                </div>
                <div className="sc-fee-preview__pill">
                  <span>Applied fee rule</span>
                  <strong>
                    {feePreview.feeType === 'fixed'
                      ? `INR ${feePreview.feeValue.toLocaleString('en-IN')}`
                      : `${feePreview.feeValue.toLocaleString('en-IN')}%`}
                  </strong>
                </div>
                <div className="sc-fee-preview__pill sc-fee-preview__pill--platform">
                  <span>Platform fee amount</span>
                  <strong>₹{feePreview.feeAmount.toLocaleString('en-IN')}</strong>
                </div>
                <div className="sc-fee-preview__pill sc-fee-preview__pill--supplier">
                  <span>Supplier net payout</span>
                  <strong>₹{feePreview.supplierNet.toLocaleString('en-IN')}</strong>
                </div>
              </div>
            </div>

            <div className="sc-footer-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveFeeMatrix}
                disabled={feeSaving || feeLoading || (feeScope === 'brand' && !selectedFeeBrand) || feeDraft.length === 0}
              >
                <Save size={18} />
                {feeSaving ? 'Saving fee matrix…' : 'Save fee matrix'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={loadFeeRules}
                disabled={feeSaving || feeLoading}
              >
                <RefreshCw size={18} />
                Reload fees
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminSupplyChain;
