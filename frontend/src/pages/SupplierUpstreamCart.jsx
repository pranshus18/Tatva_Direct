import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiUrl, authFetch } from '../config/api';
import './Dashboard.css';
import './SupplierUpstreamCart.css';
import { Check, Clipboard, Mail, MessageCircle, Pencil, Share2, Trash2 } from 'lucide-react';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpStatCard from '../components/sp/SpStatCard';
import UpstreamProductDisplay from '../components/UpstreamProductDisplay';
import { Button } from '@/components/ui/button';
import { SUPPLIER_CURRENT_STOCK_LABEL } from '../utils/supplierStockLabel';
import { formatRupee } from '../utils/formatRupee';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity';
import {
  buildSupplierProductLookupMap,
  normalizeSupplierProductsFromApi
} from '../utils/supplierProductRow';

const SUPPLIER_UPSTREAM_CART_RESUME_KEY = 'supplierUpstreamCartResumeDraft';
const emitSupplierCartUpdated = () => window.dispatchEvent(new Event('supplier-upstream-cart-updated'));

const normalizeSupplierProductKey = (value) => String(value ?? '').trim();

const normalizeSelectionMap = (raw) => {
  if (!raw || typeof raw !== 'object') return {};
  const next = {};
  Object.entries(raw).forEach(([key, val]) => {
    const normalizedKey = normalizeSupplierProductKey(key);
    if (normalizedKey) next[normalizedKey] = val;
  });
  return next;
};
const SupplierUpstreamCart = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState([]);
  const [products, setProducts] = useState([]);
  const [editingProjectId, setEditingProjectId] = useState('');
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [projectDateDraft, setProjectDateDraft] = useState('');
  const [savingProjectName, setSavingProjectName] = useState(false);
  const [sharingCart, setSharingCart] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [copyingShareLink, setCopyingShareLink] = useState(false);

  const productBySupplierProductId = useMemo(
    () => buildSupplierProductLookupMap(products),
    [products]
  );

  const projectRows = useMemo(
    () =>
      (projects || []).map((project) => {
        const selectedMine = project?.selectedMine && typeof project.selectedMine === 'object'
          ? project.selectedMine
          : {};
        const rows = Object.entries(selectedMine)
          .map(([mineId, qty]) => {
            const key = normalizeSupplierProductKey(mineId);
            const product = productBySupplierProductId[key];
            const minQty = Math.max(1, product?.min_order_quantity ?? 1);
            const parsed = parseSupplierStockQuantity(qty);
            const quantity =
              parsed != null && parsed > 0 ? Math.max(minQty, parsed) : minQty;
            return {
              mineId: key,
              quantity,
              product
            };
          })
          .filter((row) => row.product);
        return { project, rows };
      }),
    [projects, productBySupplierProductId]
  );
  const projectCount = projectRows.length;
  const totalCartLines = projectRows.reduce((sum, item) => sum + item.rows.length, 0);
  const totalCartQuantity = projectRows.reduce(
    (sum, item) => sum + item.rows.reduce((rowSum, row) => rowSum + Number(row.quantity || 0), 0),
    0
  );

  const loadCart = async () => {
    setLoading(true);
    setError('');
    try {
      const [cartRes, productsRes] = await Promise.all([
        authFetch('/api/supplier/upstream/cart', { cache: 'no-cache' }),
        authFetch('/api/supplier/products', { cache: 'no-cache' })
      ]);
      const cartData = await cartRes.json();
      const productsData = await productsRes.json();
      if (!cartRes.ok || cartData.status !== 'success') {
        throw new Error(cartData.message || 'Failed to load cart');
      }
      if (!productsRes.ok || productsData.status !== 'success') {
        throw new Error(productsData.message || 'Failed to load products');
      }
      const draft = cartData?.cart?.draft && typeof cartData.cart.draft === 'object' ? cartData.cart.draft : {};
      setProjects(Array.isArray(draft.projects) ? draft.projects : []);
      setProducts(
        normalizeSupplierProductsFromApi(
          Array.isArray(productsData.products) ? productsData.products : []
        )
      );
      emitSupplierCartUpdated();
    } catch (e) {
      setError(e.message || 'Failed to load supplier cart');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCart();
  }, []);

  const replaceProjectInState = (projectId, nextProject) => {
    setProjects((prev) =>
      (prev || []).map((project) =>
        String(project?.projectId || '') === String(projectId || '') ? nextProject : project
      )
    );
  };

  const persistProject = async (project, options = {}) => {
    const silent = options.silent === true;
    if (!silent) setSaving(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          projectId: project.projectId,
          cartName: String(project.cartName || '').trim(),
          requiredDate: String(project.requiredDate || '').trim(),
          selectedMine: project.selectedMine || {},
          selectedUpstreamOffer: project.selectedUpstreamOffer || {},
          suggestions: Array.isArray(project.suggestions) ? project.suggestions : [],
          brandFilter: String(project.brandFilter || '').trim(),
          searchTerm: String(project.searchTerm || '').trim()
        })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to save project');
      }
      return true;
    } catch (e) {
      setError(e.message || 'Failed to save project');
      return false;
    } finally {
      if (!silent) setSaving(false);
    }
  };

  const updateQuantity = async (projectId, mineId, nextQty) => {
    const key = normalizeSupplierProductKey(mineId);
    const parsed = parseSupplierStockQuantity(nextQty);
    if (parsed === null || parsed < 1) return;
    const product = productBySupplierProductId[key];
    const minQty = Math.max(1, product?.min_order_quantity ?? 1);
    const quantity = Math.max(minQty, parsed);
    const project = (projects || []).find((p) => String(p?.projectId || '') === String(projectId || ''));
    if (!project) return;
    const nextProject = {
      ...project,
      selectedMine: {
        ...(project.selectedMine || {}),
        [key]: quantity
      }
    };
    const ok = await persistProject(nextProject, { silent: true });
    if (ok) {
      replaceProjectInState(projectId, nextProject);
      emitSupplierCartUpdated();
    }
  };

  const removeLine = async (projectId, mineId) => {
    const project = (projects || []).find((p) => String(p?.projectId || '') === String(projectId || ''));
    if (!project) return;
    const nextSelectedMine = { ...(project.selectedMine || {}) };
    const nextSelectedUpstreamOffer = { ...(project.selectedUpstreamOffer || {}) };
    delete nextSelectedMine[mineId];
    delete nextSelectedUpstreamOffer[mineId];
    const nextProject = {
      ...project,
      selectedMine: nextSelectedMine,
      selectedUpstreamOffer: nextSelectedUpstreamOffer
    };
    const ok = await persistProject(nextProject, { silent: true });
    if (ok) {
      replaceProjectInState(projectId, nextProject);
      emitSupplierCartUpdated();
    }
  };

  const clearCart = async () => {
    const confirmed = window.confirm('Clear supplier cart?');
    if (!confirmed) return;
    setClearing(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to clear cart');
      }
      setProjects([]);
      emitSupplierCartUpdated();
    } catch (e) {
      setError(e.message || 'Failed to clear cart');
    } finally {
      setClearing(false);
    }
  };

  const continueToUpstream = (project) => {
    localStorage.setItem(
      SUPPLIER_UPSTREAM_CART_RESUME_KEY,
      JSON.stringify({
        selectedMine: normalizeSelectionMap(project?.selectedMine),
        selectedUpstreamOffer: normalizeSelectionMap(project?.selectedUpstreamOffer),
        suggestions: Array.isArray(project?.suggestions) ? project.suggestions : [],
        brandFilter: String(project?.brandFilter || ''),
        searchTerm: String(project?.searchTerm || ''),
        cartName: String(project?.cartName || '')
      })
    );
    navigate('/supplier-upstream');
  };

  const saveProjectName = async (projectId) => {
    const cartName = String(projectNameDraft || '').trim();
    const requiredDate = String(projectDateDraft || '').trim();
    if (!cartName) {
      setError('Project name cannot be empty.');
      return;
    }
    setSavingProjectName(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart/name'), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ projectId, cartName, requiredDate })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update project name');
      }
      const current = (projects || []).find((p) => String(p?.projectId || '') === String(projectId || ''));
      if (current) {
        replaceProjectInState(projectId, { ...current, cartName, requiredDate });
      }
      setEditingProjectId('');
      setProjectNameDraft('');
      setProjectDateDraft('');
      emitSupplierCartUpdated();
    } catch (e) {
      setError(e.message || 'Failed to update project name');
    } finally {
      setSavingProjectName(false);
    }
  };

  const handleShareCart = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in again to share cart.');
      return;
    }
    setSharingCart(true);
    setError('');
    try {
      const response = await fetch(getApiUrl('/api/cart-share'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ttlDays: 7 })
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to create share link');
      }
      const baseOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const fallbackShareUrl = data?.token && baseOrigin ? `${baseOrigin}/c/${encodeURIComponent(data.token)}` : '';
      setShareLink(String(data.shareUrl || fallbackShareUrl || ''));
    } catch (e) {
      setError(e.message || 'Failed to create share link');
    } finally {
      setSharingCart(false);
    }
  };

  const handleShareViaWhatsApp = () => {
    if (!shareLink) {
      setError('Please generate the share link first.');
      return;
    }
    const text = `Please review this supplier cart: ${shareLink}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  const handleShareViaEmail = () => {
    if (!shareLink) {
      setError('Please generate the share link first.');
      return;
    }
    const subject = 'Shared Supplier Cart';
    const body = `Hi,\n\nPlease review this supplier cart using the link below:\n${shareLink}\n\nThanks`;
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
  };

  const handleCopyShareLink = async () => {
    if (!shareLink) return;
    try {
      setCopyingShareLink(true);
      await navigator.clipboard.writeText(shareLink);
      window.setTimeout(() => setCopyingShareLink(false), 1000);
    } catch (_e) {
      setCopyingShareLink(false);
      setError('Unable to copy share link. Please copy manually.');
    }
  };

  return (
    <SpPageLayout showStepper={false}>
      <div className="dashboard-container supplier-cart-page !max-w-none !p-0">
      <SpPageHeader
        title="Supplier Cart"
        description="Every save creates a new project. Same product + same supplier will not merge into previous projects."
        icon={Pencil}
        actions={
          <>
            <Button variant="outline" disabled={loading || saving} onClick={loadCart}>
              Refresh
            </Button>
            <Button variant="outline" onClick={() => navigate('/supplier-upstream')}>
              Back to Upstream
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SpStatCard label="Projects" value={projectCount} icon={Pencil} accent="indigo" />
        <SpStatCard label="Cart Lines" value={totalCartLines} icon={Pencil} accent="emerald" />
        <SpStatCard label="Total Quantity" value={totalCartQuantity} icon={Pencil} accent="amber" />
      </div>

      <div className="dashboard-content supplier-cart-content">
        <div className="dashboard-section">
          <div className="section-header supplier-cart-toolbar">
            <h2>Projects</h2>
            <div className="supplier-cart-toolbar-actions">
              <button
                className="btn-secondary"
                disabled={loading || clearing || projectRows.length === 0}
                onClick={clearCart}
              >
                {clearing ? 'Clearing...' : 'Clear cart'}
              </button>
              <button
                className="btn-secondary"
                disabled={loading || sharingCart || projectRows.length === 0}
                onClick={handleShareCart}
              >
                <Share2 size={14} />
                {sharingCart ? 'Generating...' : 'Share cart'}
              </button>
            </div>
          </div>

          {error ? <div className="supplier-cart-error">{error}</div> : null}
          {shareLink ? (
            <div className="supplier-cart-share-panel">
              <div className="supplier-cart-share-title">Share link</div>
              <a href={shareLink} target="_blank" rel="noreferrer" className="supplier-cart-share-link">
                {shareLink}
              </a>
              <div className="supplier-cart-share-actions">
                <button className="btn-secondary" onClick={handleCopyShareLink}>
                  {copyingShareLink ? <Check size={14} /> : <Clipboard size={14} />}
                  {copyingShareLink ? 'Copied' : 'Copy'}
                </button>
                <button className="btn-secondary" onClick={handleShareViaWhatsApp}>
                  <MessageCircle size={14} />
                  WhatsApp
                </button>
                <button className="btn-secondary" onClick={handleShareViaEmail}>
                  <Mail size={14} />
                  Email
                </button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <p>Loading cart...</p>
          ) : projectRows.length === 0 ? (
            <div className="empty-state">
              <h3>Your supplier cart is empty</h3>
              <p>Add products from Upstream Orders.</p>
              <button className="btn-primary" onClick={() => navigate('/supplier-upstream')}>
                Go to Upstream Orders
              </button>
            </div>
          ) : (
            <div className="supplier-projects-stack">
              {projectRows.map(({ project, rows }) => {
                const projectId = String(project?.projectId || '');
                const totalLines = rows.length;
                const totalQuantity = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
                const totalAmount = rows.reduce((sum, row) => {
                  const offerPrice = Number(project?.selectedUpstreamOffer?.[row.mineId]?.price || 0) || 0;
                  const productPrice = Number(row?.product?.price || row?.product?.unitPrice || row?.product?.sellingPrice || 0) || 0;
                  const unitPrice = offerPrice || productPrice;
                  return sum + (unitPrice * Number(row.quantity || 0));
                }, 0);
                return (
                  <section key={projectId} className="supplier-project-card">
                    <div className="supplier-project-head">
                      <div>
                        {editingProjectId === projectId ? (
                          <div className="supplier-project-edit-row">
                            <input
                              type="text"
                              maxLength={120}
                              value={projectNameDraft}
                              onChange={(e) => setProjectNameDraft(e.target.value)}
                              className="supplier-project-name-input"
                            />
                            <input
                              type="date"
                              value={projectDateDraft}
                              onChange={(e) => setProjectDateDraft(e.target.value)}
                              className="supplier-project-name-input"
                            />
                            <button className="btn-primary" disabled={savingProjectName} onClick={() => saveProjectName(projectId)}>
                              {savingProjectName ? 'Saving...' : 'Save'}
                            </button>
                            <button className="btn-secondary" onClick={() => setEditingProjectId('')}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <h3 className="supplier-project-title">
                            {String(project?.cartName || 'Supplier Project')}
                            <button
                              type="button"
                              className="btn-icon supplier-project-edit-icon"
                              onClick={() => {
                                setEditingProjectId(projectId);
                                setProjectNameDraft(String(project?.cartName || ''));
                                setProjectDateDraft(String(project?.requiredDate || '').slice(0, 10));
                              }}
                              aria-label="Edit project name"
                            >
                              <Pencil size={14} />
                            </button>
                          </h3>
                        )}
                        <p className="supplier-project-id">Project ID: {projectId}</p>
                        {String(project?.requiredDate || '').trim() ? (
                          <p className="supplier-project-id">
                            <strong>Expected delivery: {String(project.requiredDate).slice(0, 10)}</strong>
                          </p>
                        ) : null}
                      </div>
                      <button className="btn-primary" disabled={rows.length === 0} onClick={() => continueToUpstream(project)}>
                        Continue this project
                      </button>
                    </div>

                    <div className="supplier-table-wrap">
                      <table className="supplier-cart-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Brand</th>
                            <th>MRP</th>
                            <th>{SUPPLIER_CURRENT_STOCK_LABEL}</th>
                            <th>Min Order</th>
                            <th>Quantity</th>
                            <th>Total Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => {
                            const mineId = row.mineId;
                            const p = row.product;
                            const minQty = Math.max(1, p?.min_order_quantity ?? 1);
                            const offerPrice = Number(project?.selectedUpstreamOffer?.[mineId]?.price || 0) || 0;
                            const productPrice = Number(p?.price || p?.unitPrice || p?.sellingPrice || 0) || 0;
                            const unitPrice = offerPrice || productPrice;
                            const quantity = Number(row.quantity || 0);
                            return (
                              <tr key={`${projectId}-${mineId}`}>
                                <td className="supplier-cart-product-cell">
                                  <div className="supplier-cart-product-name">{p?.name || 'Product'}</div>
                                  <UpstreamProductDisplay
                                    product={p}
                                    compact
                                    showDescription={false}
                                    showSpecifications={false}
                                    maxSpecs={8}
                                  />
                                </td>
                                <td>{p?.brandModel || p?.brand || 'N/A'}</td>
                                <td className="supplier-cart-number-cell">{formatRupee(unitPrice)}</td>
                                <td>{p?.stock ?? 0}</td>
                                <td>{minQty}</td>
                                <td>
                                  <div className="supplier-cart-qty-control">
                                    <button
                                      type="button"
                                      className="btn-secondary supplier-cart-qty-btn"
                                      onClick={() =>
                                        quantity <= 1
                                          ? removeLine(projectId, mineId)
                                          : updateQuantity(projectId, mineId, quantity - 1)
                                      }
                                      aria-label={quantity <= 1 ? 'Remove item' : 'Decrease quantity'}
                                    >
                                      {quantity <= 1 ? <Trash2 size={14} /> : '−'}
                                    </button>
                                    <span className="supplier-cart-qty-value">{quantity}</span>
                                    <button
                                      type="button"
                                      className="btn-secondary supplier-cart-qty-btn"
                                      onClick={() => updateQuantity(projectId, mineId, quantity + 1)}
                                      aria-label="Increase quantity"
                                    >
                                      +
                                    </button>
                                  </div>
                                </td>
                                <td className="supplier-cart-number-cell">{formatRupee(unitPrice * Number(row.quantity || 0))}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={4} className="supplier-cart-summary-label">
                              Project totals
                            </td>
                            <td className="supplier-cart-summary-value">{totalQuantity}</td>
                            <td className="supplier-cart-summary-value">{formatRupee(totalAmount)}</td>
                            <td className="supplier-cart-summary-meta">{totalLines} line(s)</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <p
                      style={{
                        marginTop: '0.6rem',
                        fontSize: '0.86rem',
                        color: '#64748b'
                      }}
                    >
                      <strong>
                        This is the total MRP price. To get the actual purchase price, select the supplier in the cart.
                      </strong>
                    </p>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>
    </SpPageLayout>
  );
};

export default SupplierUpstreamCart;
