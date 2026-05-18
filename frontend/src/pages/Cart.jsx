import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clipboard,
  Loader2,
  Mail,
  MessageCircle,
  Package,
  RefreshCw,
  Share2,
  Trash2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getApiUrl } from '../config/api';
import './Cart.css';

const Cart = ({ onLoadCart }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cart, setCart] = useState(null);
  const [busyByItemId, setBusyByItemId] = useState({});
  const [clearingCart, setClearingCart] = useState(false);
  const [sharingCart, setSharingCart] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [copyingShareLink, setCopyingShareLink] = useState(false);

  const token = localStorage.getItem('token');
  const cartRef = useRef(null);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  const getGroups = (draft) => {
    if (!draft || typeof draft !== 'object') return [];
    if (Array.isArray(draft.boqGroups)) return draft.boqGroups;
    if (Array.isArray(draft.items) && draft.items.length) {
      return [
        {
          groupId: 'legacy-cart',
          boqName: 'Cart Items',
          items: draft.items
        }
      ];
    }
    return [];
  };

  const mergeItemQuantityIntoDraft = (draft, itemId, nextQuantity) => {
    if (!draft || typeof draft !== 'object') return draft;
    const id = String(itemId || '');
    const qty = Math.floor(Number(nextQuantity)) || 1;
    if (Array.isArray(draft.boqGroups) && draft.boqGroups.length > 0) {
      const nextBoqGroups = draft.boqGroups.map((g) => ({
        ...g,
        items: Array.isArray(g.items)
          ? g.items.map((it) => (String(it?.id) === id ? { ...it, quantity: qty } : it))
          : []
      }));
      // Keep flat `items` in lockstep with groups (same as server normalizePoCartDraft).
      const nextFlat = nextBoqGroups.flatMap((g) => (Array.isArray(g.items) ? g.items : []));
      return { ...draft, boqGroups: nextBoqGroups, items: nextFlat };
    }
    const nextFlat = Array.isArray(draft.items)
      ? draft.items.map((it) => (String(it?.id) === id ? { ...it, quantity: qty } : it))
      : draft.items;
    return { ...draft, items: nextFlat };
  };

  /**
   * @param {{ silent?: boolean, syncWorkflow?: boolean }} [options]
   * silent: no full-page loading spinner. When syncWorkflow is true (or silent is false), push draft to parent via onLoadCart.
   */
  const loadCart = async (options = {}) => {
    const silent = options.silent === true;
    const syncWorkflow = options.syncWorkflow === true || !silent;
    if (!token) {
      setError('Please log in again to view cart.');
      setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
    }
    setError('');
    try {
      const response = await fetch(getApiUrl('/api/po/cart'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to load cart');
      }
      setCart(data.cart || null);
      if (syncWorkflow && data.cart?.draft && typeof onLoadCart === 'function') {
        onLoadCart(data.cart.draft);
      }
    } catch (e) {
      setError(e.message || 'Failed to load cart');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => getGroups(cart?.draft || {}), [cart]);
  const allItems = useMemo(
    () => groups.flatMap((group) => (Array.isArray(group?.items) ? group.items : [])),
    [groups]
  );

  const updateQuantity = async (itemId, nextQuantity) => {
    if (!token) {
      setError('Please log in again to update quantity.');
      return;
    }
    const parsed = Number(nextQuantity);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    const normalizedItemId = String(itemId || '').trim();
    if (!normalizedItemId) return;

    setBusyByItemId((prev) => ({ ...prev, [normalizedItemId]: true }));
    setError('');
    try {
      const response = await fetch(
        getApiUrl(`/api/po/cart/items/${encodeURIComponent(normalizedItemId)}/quantity`),
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ quantity: Math.floor(parsed) })
        }
      );
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update quantity');
      }
      // Avoid full reload + loading flash: merge server item (PATCH returns updated row).
      if (data.item) {
        const id = String(data.item.id ?? normalizedItemId);
        const qty = Math.floor(Number(data.item.quantity)) || parsed;
        const prev = cartRef.current;
        if (prev?.draft) {
          const nextDraft = mergeItemQuantityIntoDraft(prev.draft, id, qty);
          setCart({ ...prev, draft: nextDraft });
          if (typeof onLoadCart === 'function') {
            onLoadCart(nextDraft);
          }
        } else {
          await loadCart({ silent: true, syncWorkflow: true });
        }
      } else {
        await loadCart({ silent: true, syncWorkflow: true });
      }
    } catch (e) {
      setError(e.message || 'Failed to update quantity');
    } finally {
      setBusyByItemId((prev) => {
        const { [normalizedItemId]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleClearCart = async () => {
    if (!token) {
      setError('Please log in again to clear cart.');
      return;
    }
    const confirmed = window.confirm('Clear all cart items?');
    if (!confirmed) return;

    setClearingCart(true);
    setError('');
    try {
      const response = await fetch(getApiUrl('/api/po/cart'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to clear cart');
      }
      setCart(null);
      if (typeof onLoadCart === 'function') onLoadCart({});
    } catch (e) {
      setError(e.message || 'Failed to clear cart');
    } finally {
      setClearingCart(false);
    }
  };

  const buildDraftFromGroup = (group) => {
    if (!group || typeof group !== 'object') return null;
    const normalizedGroup = {
      groupId: String(group.groupId || `group-${Date.now()}`),
      boqId: group.boqId || null,
      boqName: group.boqName || null,
      boqProject: group.boqProject && typeof group.boqProject === 'object' ? group.boqProject : null,
      items: Array.isArray(group.items) ? group.items : [],
      selectedVendors: group.selectedVendors && typeof group.selectedVendors === 'object' ? group.selectedVendors : {},
      substitutions: Array.isArray(group.substitutions) ? group.substitutions : []
    };
    return {
      selectedVendors: normalizedGroup.selectedVendors,
      substitutions: normalizedGroup.substitutions,
      items: normalizedGroup.items,
      boqGroups: [normalizedGroup],
      boqId: normalizedGroup.boqId,
      boqProject: normalizedGroup.boqProject
    };
  };

  const buildDraftFromSingleItem = (item, group) => {
    const groupDraft = buildDraftFromGroup(group);
    if (!groupDraft || !item) return null;
    const one = groupDraft.items.find((it) => String(it?.id) === String(item?.id)) || item;
    const g0 = groupDraft.boqGroups?.[0];
    const narrowedGroup = g0
      ? {
          ...g0,
          items: [one],
          selectedVendors: g0.selectedVendors && typeof g0.selectedVendors === 'object' ? { ...g0.selectedVendors } : {}
        }
      : null;
    return {
      ...groupDraft,
      items: [one],
      boqGroups: narrowedGroup ? [narrowedGroup] : groupDraft.boqGroups
    };
  };

  const supplierSelectNavigationState = (draft) => {
    if (!draft || !Array.isArray(draft.items) || draft.items.length === 0) return undefined;
    return {
      supplierSelectItems: draft.items,
      supplierSelectBoqProject: draft.boqProject ?? null,
      supplierSelectBoqId: draft.boqId ?? null,
      fromCartSupplierSelect: true
    };
  };

  const persistSupplierSelectScope = (draft) => {
    if (!draft?.items?.length) return;
    try {
      sessionStorage.setItem('tatvaSupplierSelectScope', JSON.stringify(draft.items));
      sessionStorage.setItem('tatvaSupplierSelectScopeTs', String(Date.now()));
    } catch {
      /* ignore */
    }
  };

  const handleContinueToSupplierSelectionForGroup = (group) => {
    const groupDraft = buildDraftFromGroup(group);
    if (groupDraft && typeof onLoadCart === 'function') onLoadCart(groupDraft);
    persistSupplierSelectScope(groupDraft);
    const navState = supplierSelectNavigationState(groupDraft);
    navigate('/supplier-select', navState ? { state: navState } : {});
  };

  /** One cart line → supplier rank API only receives that product (correct supplier list). */
  const handleContinueToSupplierSelectionForItem = (item, group) => {
    const draft = buildDraftFromSingleItem(item, group);
    if (draft && typeof onLoadCart === 'function') onLoadCart(draft);
    persistSupplierSelectScope(draft);
    const navState = supplierSelectNavigationState(draft);
    navigate('/supplier-select', navState ? { state: navState } : {});
  };

  const handleShareCart = async () => {
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
    const text = `Please review this cart: ${shareLink}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    setShareLink('');
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  const handleShareViaEmail = () => {
    if (!shareLink) {
      setError('Please generate the share link first.');
      return;
    }
    const subject = 'Shared Cart';
    const body = `Hi,\n\nPlease review this cart using the link below:\n${shareLink}\n\nThanks`;
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setShareLink('');
    window.location.href = mailtoUrl;
  };

  const handleCopyShareLink = async () => {
    if (!shareLink) return;
    try {
      setCopyingShareLink(true);
      await navigator.clipboard.writeText(shareLink);
      setCopyingShareLink(false);
      setShareLink('');
    } catch {
      setError('Unable to copy the share link. Please copy it manually.');
      setCopyingShareLink(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Cart</h1>
        <p>Review items, change quantity, then use <strong>Select supplier</strong> on a row for that product only, or choose suppliers for the whole group.</p>
      </div>

      <div className="cart-shell">
        {error ? (
          <div className="cart-alert cart-alert--error">
            <AlertCircle size={16} />
            <span>{String(error || 'Unknown cart error')}</span>
          </div>
        ) : null}

        <div className="cart-action-row">
          <button type="button" className="btn-secondary" onClick={loadCart} disabled={loading}>
            <RefreshCw size={16} />
            Refresh Cart
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClearCart}
            disabled={clearingCart || loading || allItems.length === 0}
          >
            <Trash2 size={16} />
            {clearingCart ? 'Clearing...' : 'Clear Cart'}
          </button>
        </div>

        {loading ? (
          <div className="cart-loading-card">
            <Loader2 size={16} />
            <span>Loading cart...</span>
          </div>
        ) : allItems.length === 0 ? (
          <div className="cart-empty-card">
            <Package size={18} />
            <div>
              <h3>Your cart is empty</h3>
              <p>Go to Product Discovery, add items, then come back for supplier selection.</p>
            </div>
          </div>
        ) : (
          <div className="cart-boq-groups">
            {groups.map((group, groupIndex) => {
              const items = Array.isArray(group?.items) ? group.items : [];
              return (
                <section className="cart-boq-group" key={String(group?.groupId || groupIndex)}>
                  <div className="cart-boq-group__head">
                    <div>
                      <h4>{String(group?.boqName || `Group ${groupIndex + 1}`)}</h4>
                      {group?.boqProject?.name ? (
                        <p className="cart-boq-group__meta">Project: {String(group.boqProject.name)}</p>
                      ) : null}
                      <p className="cart-boq-group__meta">{items.length} item{items.length === 1 ? '' : 's'}</p>
                    </div>
                    <div className="cart-boq-group__actions">
                      <button
                        type="button"
                        className="btn-secondary cart-boq-group__btn"
                        disabled={items.length === 0}
                        onClick={() => handleContinueToSupplierSelectionForGroup(group)}
                        title="Choose suppliers for every line in this group at once"
                      >
                        All items in group <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="cart-items-panel">
                    <div className="cart-items-table-wrap">
                      <table className="cart-items-table">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Unit</th>
                            <th>Quantity</th>
                            <th>Supplier</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => {
                            const itemId = String(item?.id || '');
                            const quantity = Number(item?.quantity || 1);
                            const isBusy = Boolean(busyByItemId[itemId]);
                            return (
                              <tr key={itemId || `${groupIndex}-${String(item?.name || '')}`}>
                                <td>{String(item?.normalizedName || item?.rawName || item?.name || 'Item')}</td>
                                <td>{String(item?.unit || 'nos')}</td>
                                <td>
                                  <div className="cart-qty-control">
                                    <button
                                      type="button"
                                      className="cart-qty-btn"
                                      disabled={isBusy || quantity <= 1}
                                      onClick={() => updateQuantity(itemId, quantity - 1)}
                                    >
                                      -
                                    </button>
                                    <span className="cart-qty-value">{quantity}</span>
                                    <button
                                      type="button"
                                      className="cart-qty-btn"
                                      disabled={isBusy}
                                      onClick={() => updateQuantity(itemId, quantity + 1)}
                                    >
                                      +
                                    </button>
                                  </div>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn-primary cart-row-supplier-btn"
                                    disabled={!itemId}
                                    onClick={() => handleContinueToSupplierSelectionForItem(item, group)}
                                    title="Rank and choose suppliers for this line only"
                                  >
                                    Select supplier <ArrowRight size={14} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <div className="cart-action-row">
          <button
            type="button"
            className="btn-secondary cart-share-btn"
            onClick={handleShareCart}
            disabled={sharingCart || loading || allItems.length === 0}
          >
            <Share2 size={16} />
            {sharingCart ? 'Generating...' : 'Share Cart'}
          </button>
        </div>

        {shareLink ? (
          <div className="cart-share-link-row">
            <span className="cart-share-link-label">Share link</span>
            <a className="cart-share-link" href={shareLink} target="_blank" rel="noreferrer">
              {shareLink}
            </a>
            <button type="button" className="btn-secondary cart-share-copy-mini" onClick={handleCopyShareLink}>
              {copyingShareLink ? <Check size={16} /> : <Clipboard size={16} />}
              {copyingShareLink ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="btn-secondary cart-share-copy-mini" onClick={handleShareViaWhatsApp}>
              <MessageCircle size={16} />
              WhatsApp
            </button>
            <button type="button" className="btn-secondary cart-share-copy-mini" onClick={handleShareViaEmail}>
              <Mail size={16} />
              Email
            </button>
          </div>
        ) : null}

      </div>
    </div>
  );
};

export default Cart;
