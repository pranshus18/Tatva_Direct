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
  ShoppingCart,
  Trash2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getApiUrl } from '../config/api';
import { persistSupplierSelectScopeFromCart } from '../constants/supplierSelectSession';
import VoiceGuidedBanner from '../components/VoiceGuidedBanner';
import SpWorkflowPage from '../components/sp/SpWorkflowPage';
import SpEmptyState from '../components/sp/SpEmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

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

  useEffect(() => {
    const onVoiceCart = () => {
      loadCart({ silent: true, syncWorkflow: true });
    };
    window.addEventListener('voice-cart-updated', onVoiceCart);
    return () => window.removeEventListener('voice-cart-updated', onVoiceCart);
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

  const handleContinueToSupplierSelectionForGroup = (group) => {
    const groupDraft = buildDraftFromGroup(group);
    if (groupDraft && typeof onLoadCart === 'function') onLoadCart(groupDraft);
    persistSupplierSelectScopeFromCart(groupDraft.items);
    const navState = supplierSelectNavigationState(groupDraft);
    navigate(
      { pathname: '/supplier-select', search: '?from=cart' },
      navState ? { state: navState } : {}
    );
  };

  /** One cart line → supplier rank API only receives that product (correct supplier list). */
  const handleContinueToSupplierSelectionForItem = (item, group) => {
    const draft = buildDraftFromSingleItem(item, group);
    if (draft && typeof onLoadCart === 'function') onLoadCart(draft);
    persistSupplierSelectScopeFromCart(draft.items);
    const navState = supplierSelectNavigationState(draft);
    navigate(
      { pathname: '/supplier-select', search: '?from=cart' },
      navState ? { state: navState } : {}
    );
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

  const totalQty = allItems.reduce((sum, it) => sum + (Number(it?.quantity) || 1), 0);

  return (
    <SpWorkflowPage
      title="Shopping cart"
      description="Review line items, adjust quantities, then choose suppliers before creating a purchase order."
      icon={ShoppingCart}
    >
      <VoiceGuidedBanner />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={loadCart} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClearCart}
          disabled={clearingCart || loading || allItems.length === 0}
        >
          <Trash2 className="h-4 w-4" />
          {clearingCart ? 'Clearing…' : 'Clear cart'}
        </Button>
        {allItems.length > 0 ? (
          <Badge variant="secondary" className="ml-auto">
            {allItems.length} line{allItems.length === 1 ? '' : 's'} · {totalQty} units
          </Badge>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          {loading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : allItems.length === 0 ? (
            <SpEmptyState
              icon={Package}
              title="Your cart is empty"
              description="Browse the catalog or upload a BOQ to add materials to your cart."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => navigate('/product-discovery')}>Browse catalog</Button>
                  <Button variant="outline" onClick={() => navigate('/boq-normalize')}>
                    Upload BOQ
                  </Button>
                </div>
              }
            />
          ) : (
            groups.map((group, groupIndex) => {
              const items = Array.isArray(group?.items) ? group.items : [];
              return (
                <Card key={String(group?.groupId || groupIndex)} className="sp-market-card overflow-hidden">
                  <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 border-b bg-muted/30 pb-4">
                    <div>
                      <CardTitle className="text-base">
                        {String(group?.boqName || `BOQ group ${groupIndex + 1}`)}
                      </CardTitle>
                      {group?.boqProject?.name ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Project: {String(group.boqProject.name)}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {items.length} item{items.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      disabled={items.length === 0}
                      onClick={() => handleContinueToSupplierSelectionForGroup(group)}
                    >
                      All in group
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ul className="divide-y">
                      {items.map((item) => {
                        const itemId = String(item?.id || '');
                        const quantity = Number(item?.quantity || 1);
                        const isBusy = Boolean(busyByItemId[itemId]);
                        const name = String(
                          item?.normalizedName || item?.rawName || item?.name || 'Item'
                        );
                        return (
                          <li
                            key={itemId || `${groupIndex}-${name}`}
                            className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-foreground">{name}</p>
                              <p className="mt-0.5 text-sm text-muted-foreground">
                                Unit: {String(item?.unit || 'nos')}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                              <div className="flex items-center rounded-md border bg-background">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 rounded-none"
                                  disabled={isBusy || quantity <= 1}
                                  onClick={() => updateQuantity(itemId, quantity - 1)}
                                  aria-label="Decrease quantity"
                                >
                                  −
                                </Button>
                                <span className="min-w-[2.5rem] text-center text-sm font-semibold tabular-nums">
                                  {isBusy ? '…' : quantity}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 rounded-none"
                                  disabled={isBusy}
                                  onClick={() => updateQuantity(itemId, quantity + 1)}
                                  aria-label="Increase quantity"
                                >
                                  +
                                </Button>
                              </div>
                              <Button
                                size="sm"
                                disabled={!itemId}
                                onClick={() => handleContinueToSupplierSelectionForItem(item, group)}
                              >
                                Select supplier
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="sp-market-card shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Line items</span>
                <span className="font-medium">{allItems.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total quantity</span>
                <span className="font-medium">{totalQty}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">BOQ groups</span>
                <span className="font-medium">{groups.length}</span>
              </div>
              <Separator />
              <p className="text-xs text-muted-foreground">
                Supplier pricing is confirmed in the next step. Continue when your cart looks correct.
              </p>
            </CardContent>
            <CardFooter className="flex flex-col gap-2 border-t bg-muted/20 pt-4">
              <Button
                className="w-full"
                size="lg"
                disabled={loading || allItems.length === 0}
                onClick={() => {
                  if (groups[0]) handleContinueToSupplierSelectionForGroup(groups[0]);
                  else navigate('/supplier-select');
                }}
              >
                Continue to suppliers
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="w-full"
                disabled={allItems.length === 0}
                onClick={() => navigate('/create-po')}
              >
                Skip to create PO
              </Button>
            </CardFooter>
          </Card>

          {allItems.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Share cart</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full"
                  size="sm"
                  onClick={handleShareCart}
                  disabled={sharingCart || loading}
                >
                  <Share2 className="h-4 w-4" />
                  {sharingCart ? 'Generating link…' : 'Generate share link'}
                </Button>
                {shareLink ? (
                  <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Share link</p>
                    <a
                      href={shareLink}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all text-xs text-primary hover:underline"
                    >
                      {shareLink}
                    </a>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={handleCopyShareLink}>
                        {copyingShareLink ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                        {copyingShareLink ? 'Copied' : 'Copy'}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={handleShareViaWhatsApp}>
                        <MessageCircle className="h-4 w-4" />
                        WhatsApp
                      </Button>
                      <Button variant="secondary" size="sm" onClick={handleShareViaEmail}>
                        <Mail className="h-4 w-4" />
                        Email
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </SpWorkflowPage>
  );
};

export default Cart;
