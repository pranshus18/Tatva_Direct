import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Clipboard, LogIn, ShoppingCart } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { formatDateTimeIST } from '../utils/dateTime';
import './SharedCart.css';

const SharedCart = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shared, setShared] = useState(null);
  const [copied, setCopied] = useState(false);

  const authToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const userRaw = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  const user = (() => {
    try {
      return userRaw ? JSON.parse(userRaw) : null;
    } catch {
      return null;
    }
  })();

  const draft = shared?.draft || {};
  const itemCount = useMemo(() => {
    if (Array.isArray(draft?.boqGroups) && draft.boqGroups.length > 0) {
      return draft.boqGroups.reduce((n, g) => n + (Array.isArray(g?.items) ? g.items.length : 0), 0);
    }
    if (Array.isArray(draft?.items)) return draft.items.length;
    const mine = draft?.selectedMine && typeof draft.selectedMine === 'object' ? Object.keys(draft.selectedMine).length : 0;
    const offers =
      draft?.selectedUpstreamOffer && typeof draft.selectedUpstreamOffer === 'object'
        ? Object.keys(draft.selectedUpstreamOffer).length
        : 0;
    return mine || offers ? mine + offers : 0;
  }, [draft]);

  const fetchShared = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(getApiUrl(`/api/cart-share/${encodeURIComponent(token || '')}`));
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to load shared cart');
      }
      setShared(data.sharedCart);
    } catch (e) {
      setError(e.message || 'Failed to load shared cart');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShared();
  }, [token]);

  const handleCopyLink = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      alert('Copy failed. Please copy the URL from the address bar.');
    }
  };

  const handleLoginToLoad = () => {
    if (!token) return;
    localStorage.setItem('pendingSharedCartToken', String(token));
    navigate('/login');
  };

  const handleApplyToMyCart = async () => {
    if (!token) return;
    if (!authToken) {
      handleLoginToLoad();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(getApiUrl(`/api/cart-share/${encodeURIComponent(token)}/apply`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to apply shared cart');
      }
      const userType = String(user?.userType || '').toLowerCase();
      navigate(userType === 'supplier' ? '/supplier-cart' : '/cart');
    } catch (e) {
      setError(e.message || 'Failed to apply shared cart');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Shared Cart</h1>
          <p>Loading shared cart details…</p>
        </div>
        <div className="shared-cart-card">
          <div className="spinner" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Shared Cart</h1>
          <p>This link may be invalid or expired.</p>
        </div>
        <div className="shared-cart-alert shared-cart-alert--error">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Shared Cart</h1>
        <p>Review the cart and load it into your account.</p>
      </div>

      <div className="shared-cart-card">
        <div className="shared-cart-card__summary">
          <ShoppingCart size={18} />
          <div>
            <strong>{itemCount || 0} item(s)</strong>
            {shared?.expiresAt ? <span>Link expires on {formatDateTimeIST(shared.expiresAt, '—')}</span> : null}
          </div>
        </div>

        <div className="shared-cart-actions">
          <button type="button" className="btn-secondary" onClick={handleCopyLink}>
            <Clipboard size={16} />
            {copied ? 'Copied' : 'Copy link'}
          </button>

          {!authToken ? (
            <button type="button" className="btn-primary" onClick={handleLoginToLoad}>
              <LogIn size={16} />
              Login to load this cart
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={handleApplyToMyCart} disabled={busy}>
              {busy ? 'Loading…' : 'Load into my cart'}
            </button>
          )}
        </div>

        {Array.isArray(draft?.items) && draft.items.length > 0 ? (
          <div className="shared-cart-preview">
            <h3>Preview</h3>
            <ul>
              {draft.items.slice(0, 25).map((it, idx) => (
                <li key={it?.id || `${it?.normalizedName || it?.rawName || 'item'}-${idx}`}>
                  <span className="name">{it?.normalizedName || it?.rawName || 'Item'}</span>
                  <span className="qty">Qty: {it?.quantity ?? '-'}</span>
                </li>
              ))}
            </ul>
            {draft.items.length > 25 ? <p className="shared-cart-muted">Showing first 25 items.</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SharedCart;

