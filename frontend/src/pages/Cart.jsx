import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Boxes, Building2, CalendarClock, Clipboard, Mail, MessageCircle, Share2, ShoppingCart, Trash2, X } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { formatDateTimeIST } from '../utils/dateTime';
import './Cart.css';

const Cart = ({ onLoadCart }) => {
  const navigate = useNavigate();
  const user = (() => {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();
  const isSupplierCart = user?.userType === 'supplier';
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [shareError, setShareError] = useState('');
  const [shareCopied, setShareCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [qtyBusyByItem, setQtyBusyByItem] = useState({});
  const [qtyDraftByItem, setQtyDraftByItem] = useState({});
  const qtySaveTimersRef = useRef({});
  const cartRef = useRef(null);

  const boqGroups = useMemo(() => {
    const draft = cart?.draft || {};
    if (Array.isArray(draft.boqGroups) && draft.boqGroups.length > 0) {
      return draft.boqGroups;
    }
    if (Array.isArray(draft.items) && draft.items.length > 0) {
      return [
        {
          groupId: 'legacy-flat',
          boqId: draft.boqId ?? null,
          boqName: null,
          boqProject: draft.boqProject ?? null,
          items: draft.items,
          selectedVendors: draft.selectedVendors || {},
          substitutions: draft.substitutions || []
        }
      ];
    }
    return [];
  }, [cart]);

  const summary = useMemo(() => {
    const draft = cart?.draft || {};
    const items = Array.isArray(draft.items) ? draft.items : [];
    const itemCount = boqGroups.length
      ? boqGroups.reduce((n, g) => n + (Array.isArray(g.items) ? g.items.length : 0), 0)
      : items.length;
    const selected = draft.selectedVendors && typeof draft.selectedVendors === 'object'
      ? Object.values(draft.selectedVendors).filter(Boolean).length
      : 0;
    const suppliers = new Set(Object.values(draft.selectedVendors || {}).filter(Boolean).map((v) => String(v)));
    return {
      itemCount,
      selectedCount: selected,
      supplierCount: suppliers.size,
      boqSectionCount: boqGroups.length
    };
  }, [cart, boqGroups]);

  const cartItems = useMemo(() => {
    const draft = cart?.draft || {};
    return Array.isArray(draft.items) ? draft.items : [];
  }, [cart]);

  const fetchCart = async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl(isSupplierCart ? '/api/supplier/upstream/cart' : '/api/po/cart'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to load cart');
      }
      setCart(data.cart);
    } catch (e) {
      setError(e.message || 'Failed to load cart');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  useEffect(() => {
    return () => {
      Object.values(qtySaveTimersRef.current || {}).forEach((timerId) => {
        clearTimeout(timerId);
      });
    };
  }, []);

  useEffect(() => {
    fetchCart();
  }, []);

  const handleContinueWithBoqGroup = (group) => {
    if (!group || !Array.isArray(group.items) || group.items.length === 0) return;
    const workflowDraft = {
      items: group.items,
      selectedVendors: group.selectedVendors && typeof group.selectedVendors === 'object' ? group.selectedVendors : {},
      substitutions: Array.isArray(group.substitutions) ? group.substitutions : [],
      boqId: group.boqId || null,
      boqProject: group.boqProject || null
    };
    if (typeof onLoadCart === 'function') {
      onLoadCart(workflowDraft);
    }
    navigate(isSupplierCart ? '/supplier-upstream' : '/supplier-select');
  };

  const handleUseCart = () => {
    const draft = cart?.draft;
    if (isSupplierCart) {
      if (!draft || !Array.isArray(draft.items) || draft.items.length === 0) {
        if (draft && Object.keys(draft.selectedMine || {}).length > 0) {
          localStorage.setItem('supplierUpstreamCartResumeDraft', JSON.stringify(draft));
          navigate('/supplier-upstream');
        }
        return;
      }
      if (typeof onLoadCart === 'function') {
        onLoadCart(draft);
      }
      navigate('/supplier-upstream');
      return;
    }
    if (!boqGroups.length) {
      if (!draft || !Array.isArray(draft.items) || draft.items.length === 0) return;
      if (typeof onLoadCart === 'function') {
        onLoadCart(draft);
      }
      navigate('/supplier-select');
      return;
    }
    if (boqGroups.length >= 1) {
      handleContinueWithBoqGroup(boqGroups[0]);
    }
  };

  const handleRemoveBoqGroup = async (groupId) => {
    if (!groupId || !window.confirm('Remove this BOQ and its lines from the cart?')) return;
    setBusy(true);
    try {
      const token = localStorage.getItem('token');
      const draft = cart?.draft || {};
      const prevGroups = Array.isArray(draft.boqGroups) && draft.boqGroups.length > 0
        ? draft.boqGroups
        : boqGroups;
      const nextGroups = prevGroups.filter((g) => String(g.groupId) !== String(groupId));
      if (nextGroups.length === 0) {
        const res = await fetch(getApiUrl('/api/po/cart'), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') {
          throw new Error(data.message || 'Failed to update cart');
        }
        setCart(null);
        return;
      }
      const flatItems = nextGroups.flatMap((g) => g.items || []);
      const mergedSelected = {};
      nextGroups.forEach((g) => {
        if (g.selectedVendors && typeof g.selectedVendors === 'object') {
          Object.assign(mergedSelected, g.selectedVendors);
        }
      });
      const res = await fetch(getApiUrl('/api/po/cart'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          selectedVendors: mergedSelected,
          substitutions: [],
          items: flatItems,
          boqGroups: nextGroups,
          boqId: nextGroups[0]?.boqId ?? null,
          boqProject: nextGroups[0]?.boqProject ?? null,
          requiredDate: draft.requiredDate ?? null,
          paymentMethod: draft.paymentMethod ?? null,
          deliveryDestination: draft.deliveryDestination ?? null,
          shippingAddress: draft.shippingAddress ?? null,
          billingAddress: draft.billingAddress ?? null,
          gstin: draft.gstin ?? null
        })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update cart');
      }
      await fetchCart();
    } catch (e) {
      alert(e.message || 'Failed to remove BOQ from cart');
    } finally {
      setBusy(false);
    }
  };

  const handleClearCart = async () => {
    if (!window.confirm('Clear saved cart?')) return;
    setBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl(isSupplierCart ? '/api/supplier/upstream/cart' : '/api/po/cart'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to clear cart');
      }
      setCart(null);
    } catch (e) {
      alert(e.message || 'Failed to clear cart');
    } finally {
      setBusy(false);
    }
  };

  const ensureShareLink = async () => {
    if (shareLink) return shareLink;
    setShareBusy(true);
    setShareError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/cart-share'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ttlDays: 7 })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to create share link');
      }
      const url = data.shareUrl || (typeof window !== 'undefined'
        ? `${window.location.origin}/c/${encodeURIComponent(data.token)}`
        : '');
      setShareLink(url);
      return url;
    } catch (e) {
      setShareError(e.message || 'Failed to create share link');
      throw e;
    } finally {
      setShareBusy(false);
    }
  };

  const handleCopyShareLink = async () => {
    try {
      const url = await ensureShareLink();
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1200);
    } catch (e) {
      alert(e.message || 'Copy failed');
    }
  };

  const handleOpenShare = async () => {
    if (!hasCart) return;
    setShareOpen(true);
    try {
      await ensureShareLink();
    } catch {
      // errors are shown inside modal
    }
  };

  const handleShareWhatsApp = async () => {
    try {
      const url = await ensureShareLink();
      const message = `Here is my cart from Tatva Direct:\n${url}`;
      const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      alert(e.message || 'Failed to share');
    }
  };

  const handleShareGmail = async () => {
    try {
      const url = await ensureShareLink();
      const subject = 'Shared cart - Tatva Direct';
      const body = `Hi,\n\nSharing my cart with you:\n${url}\n\nRegards`;
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(gmailUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      alert(e.message || 'Failed to share');
    }
  };

  const setItemQuantityBusy = (itemId, isBusy) => {
    const key = String(itemId);
    setQtyBusyByItem((prev) => {
      if (!isBusy) {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: true };
    });
  };

  const handleUpdateQuantity = async (item, nextQuantity) => {
    const itemId = item?.id;
    if (itemId === undefined || itemId === null) {
      alert('This cart item cannot be edited because its id is missing.');
      return;
    }
    const rounded = Number.isFinite(Number(nextQuantity)) ? Math.floor(Number(nextQuantity)) : NaN;
    if (!Number.isFinite(rounded) || rounded < 1) {
      alert('Quantity must be at least 1.');
      return;
    }

    const idKey = String(itemId);
    setItemQuantityBusy(idKey, true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl(`/api/po/cart/items/${encodeURIComponent(idKey)}/quantity`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ quantity: rounded })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update quantity');
      }

      setCart((prev) => {
        if (!prev?.draft || !Array.isArray(prev.draft.items)) return prev;
        const nextItems = prev.draft.items.map((draftItem) => (
          String(draftItem?.id) === idKey ? { ...draftItem, quantity: rounded } : draftItem
        ));
        const nextBoqGroups = Array.isArray(prev.draft.boqGroups)
          ? prev.draft.boqGroups.map((g) => ({
              ...g,
              items: Array.isArray(g.items)
                ? g.items.map((it) => (String(it?.id) === idKey ? { ...it, quantity: rounded } : it))
                : g.items
            }))
          : prev.draft.boqGroups;
        return {
          ...prev,
          draft: {
            ...prev.draft,
            items: nextItems,
            boqGroups: nextBoqGroups
          }
        };
      });
      setQtyDraftByItem((prev) => ({ ...prev, [idKey]: String(rounded) }));
    } catch (e) {
      alert(e.message || 'Failed to update quantity');
    } finally {
      setItemQuantityBusy(idKey, false);
    }
  };

  const scheduleQtyAutoSave = (itemId, value) => {
    const key = String(itemId);
    const parsed = parseInt(String(value).trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return;

    if (qtySaveTimersRef.current[key]) {
      clearTimeout(qtySaveTimersRef.current[key]);
    }

    qtySaveTimersRef.current[key] = setTimeout(() => {
      const latestCart = cartRef.current;
      const latestItems = latestCart?.draft?.items;
      const latestItem = Array.isArray(latestItems)
        ? latestItems.find((it) => String(it?.id) === key)
        : null;
      if (!latestItem) return;

      const current = parseInt(latestItem.quantity, 10) || 1;
      if (parsed !== current) {
        handleUpdateQuantity(latestItem, parsed);
      }
    }, 700);
  };

  const handleQtyInputChange = (itemId, value) => {
    setQtyDraftByItem((prev) => ({ ...prev, [String(itemId)]: value }));
    scheduleQtyAutoSave(itemId, value);
  };

  const commitQtyDraft = async (item) => {
    const key = String(item?.id);
    const draftValue = qtyDraftByItem[key];
    if (draftValue === undefined) return;
    const parsed = parseInt(String(draftValue).trim(), 10);
    const current = parseInt(item?.quantity, 10) || 1;
    if (!Number.isFinite(parsed) || parsed < 1) {
      setQtyDraftByItem((prev) => ({ ...prev, [key]: String(current) }));
      alert('Quantity must be a whole number greater than 0.');
      return;
    }
    if (parsed === current) return;
    await handleUpdateQuantity(item, parsed);
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Cart</h1>
          <p>Preparing your saved draft...</p>
        </div>
        <div className="cart-loading-card">
          <div className="spinner" />
          <span>Loading cart details...</span>
        </div>
      </div>
    );
  }

  const hasCart = Boolean(cart);
  const statCards = isSupplierCart
    ? [
        { label: 'Selected Products', value: Object.keys(cart?.draft?.selectedMine || {}).length, icon: Boxes },
        { label: 'Chosen Upstream Offers', value: Object.keys(cart?.draft?.selectedUpstreamOffer || {}).length, icon: Building2 },
        { label: 'Loaded Suggestions', value: Array.isArray(cart?.draft?.suggestions) ? cart.draft.suggestions.length : 0, icon: ShoppingCart }
      ]
    : [
        { label: 'BOQs in cart', value: summary.boqSectionCount || (summary.itemCount ? 1 : 0), icon: Boxes },
        { label: 'Items', value: summary.itemCount, icon: ShoppingCart },
        { label: 'Suppliers involved', value: summary.supplierCount, icon: Building2 }
      ];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Cart</h1>
        <p>{isSupplierCart ? 'Saved upstream ordering draft' : 'Saved BOQ draft for later checkout'}</p>
      </div>

      {error ? (
        <div className="cart-alert cart-alert--error">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {!hasCart ? (
        <div className="cart-empty-card">
          <ShoppingCart size={22} />
          <div>
            <h3>No saved cart found</h3>
            <p>Add items to cart from BOQ Normalize to continue later.</p>
          </div>
        </div>
      ) : (
        <div className="cart-shell">
          <div className="cart-stat-grid">
            {statCards.map((card) => {
              const Icon = card.icon;
              return (
                <div className="cart-stat-card" key={card.label}>
                  <div className="cart-stat-icon">
                    <Icon size={18} />
                  </div>
                  <div className="cart-stat-content">
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="cart-meta-row">
            <CalendarClock size={16} />
            <span>
              Last saved: <strong>{formatDateTimeIST(cart.updatedAt, '-')}</strong>
            </span>
          </div>

          {!isSupplierCart && (
            <div className="cart-items-panel">
              <div className="cart-items-panel__head">
                <h3>Saved by BOQ</h3>
                <span>
                  {boqGroups.length} BOQ{boqGroups.length === 1 ? '' : 's'} · {cartItems.length} line(s)
                </span>
              </div>
              {cartItems.length === 0 ? (
                <p className="cart-items-empty">No BOQ items are saved in this cart yet.</p>
              ) : (
                <div className="cart-boq-groups">
                  {boqGroups.map((group, gIdx) => {
                    const gItems = Array.isArray(group.items) ? group.items : [];
                    const titleParts = [`BOQ ${gIdx + 1}`];
                    if (group.boqId) titleParts.push(`(${String(group.boqId).slice(0, 8)}…)`);
                    if (group.boqProject?.location) titleParts.push(`— ${group.boqProject.location}`);
                    const heading = titleParts.join(' ');
                    return (
                      <div className="cart-boq-group" key={group.groupId || `g-${gIdx}`}>
                        <div className="cart-boq-group__head">
                          <div>
                            <h4>{heading}</h4>
                            {group.boqProject?.requiredDate ? (
                              <p className="cart-boq-group__meta">
                                Required: {group.boqProject.requiredDate}
                              </p>
                            ) : null}
                          </div>
                          <div className="cart-boq-group__actions">
                            <button
                              type="button"
                              className="btn-secondary cart-boq-group__btn"
                              onClick={() => handleContinueWithBoqGroup(group)}
                              disabled={gItems.length === 0}
                            >
                              Continue this BOQ
                            </button>
                            {group.groupId && String(group.groupId) !== 'legacy-flat' ? (
                              <button
                                type="button"
                                className="btn-secondary cart-boq-group__btn cart-boq-group__btn--danger"
                                onClick={() => handleRemoveBoqGroup(group.groupId)}
                                disabled={busy}
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <div className="cart-items-table-wrap">
                          <table className="cart-items-table">
                            <thead>
                              <tr>
                                <th>Item</th>
                                <th>Qty</th>
                                <th>Unit</th>
                                <th>Suppliers</th>
                                <th>Match</th>
                              </tr>
                            </thead>
                            <tbody>
                              {gItems.map((item, index) => (
                                <tr key={item.id || `${item.normalizedName || item.rawName}-${gIdx}-${index}`}>
                                  <td>{item.normalizedName || item.rawName || '-'}</td>
                                  <td>
                                    <div className="cart-qty-control">
                                      <button
                                        type="button"
                                        className="cart-qty-btn"
                                        disabled={Boolean(qtyBusyByItem[String(item.id)])}
                                        onClick={() =>
                                          handleUpdateQuantity(item, (parseInt(item.quantity, 10) || 1) - 1)
                                        }
                                      >
                                        -
                                      </button>
                                      <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        className="cart-qty-input"
                                        value={qtyDraftByItem[String(item.id)] ?? String(item.quantity ?? '')}
                                        disabled={Boolean(qtyBusyByItem[String(item.id)])}
                                        onChange={(e) => handleQtyInputChange(item.id, e.target.value)}
                                        onBlur={() => commitQtyDraft(item)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            commitQtyDraft(item);
                                          }
                                        }}
                                      />
                                      <button
                                        type="button"
                                        className="cart-qty-btn"
                                        disabled={Boolean(qtyBusyByItem[String(item.id)])}
                                        onClick={() =>
                                          handleUpdateQuantity(item, (parseInt(item.quantity, 10) || 0) + 1)
                                        }
                                      >
                                        +
                                      </button>
                                    </div>
                                  </td>
                                  <td>{item.unit || 'nos'}</td>
                                  <td>{item.availableSuppliers ?? 0}</td>
                                  <td>
                                    {typeof item.confidence === 'number'
                                      ? `${Math.round(item.confidence * 100)}%`
                                      : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="cart-action-row">
            {!isSupplierCart && boqGroups.length > 1 ? (
              <p className="cart-multi-boq-hint">
                Multiple BOQs are stored separately. Use <strong>Continue this BOQ</strong> under the section you want
                to order.
              </p>
            ) : null}
            {isSupplierCart || boqGroups.length <= 1 ? (
              <button className="btn-primary" onClick={handleUseCart} disabled={!isSupplierCart && boqGroups.length === 0}>
                {isSupplierCart ? 'Continue Upstream Ordering' : 'Continue to Supplier Selection'}
              </button>
            ) : null}

            <button
              className="btn-secondary cart-share-btn"
              onClick={handleOpenShare}
              disabled={shareBusy || !hasCart}
              title={!hasCart ? 'No cart to share' : 'Share this cart'}
              type="button"
            >
              <Share2 size={16} />
              {shareBusy ? 'Preparing...' : 'Share'}
            </button>

            <button className="btn-secondary" onClick={handleClearCart} disabled={busy}>
              <Trash2 size={16} />
              {busy ? 'Clearing...' : 'Clear Cart'}
            </button>
          </div>

          {shareOpen ? (
            <div
              className="cart-share-modal-backdrop"
              role="presentation"
              onClick={() => setShareOpen(false)}
            >
              <div
                className="cart-share-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Share cart"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="cart-share-modal__head">
                  <div>
                    <h3>Share cart</h3>
                    <p>Send this cart link on WhatsApp or Gmail.</p>
                  </div>
                  <button type="button" className="cart-share-modal__close" onClick={() => setShareOpen(false)}>
                    <X size={18} />
                  </button>
                </div>

                {shareError ? (
                  <div className="cart-alert cart-alert--error" style={{ marginBottom: '0.75rem' }}>
                    <AlertTriangle size={18} />
                    <span>{shareError}</span>
                  </div>
                ) : null}

                <div className="cart-share-link-row">
                  <span className="cart-share-link-label">Link</span>
                  <a className="cart-share-link" href={shareLink || '#'} target="_blank" rel="noreferrer">
                    {shareLink || (shareBusy ? 'Preparing link…' : '-')}
                  </a>
                  <button type="button" className="btn-secondary cart-share-copy-mini" onClick={handleCopyShareLink} disabled={!shareLink}>
                    <Clipboard size={16} />
                    {shareCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <div className="cart-share-modal__actions">
                  <button type="button" className="btn-secondary" onClick={handleShareWhatsApp} disabled={!shareLink}>
                    <MessageCircle size={16} />
                    WhatsApp
                  </button>
                  <button type="button" className="btn-secondary" onClick={handleShareGmail} disabled={!shareLink}>
                    <Mail size={16} />
                    Gmail
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default Cart;
