import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import ProductImageCarousel from '../components/ProductImageCarousel';
import { collectProductImages } from '../components/UpstreamProductDisplay';
import { getApiUrl, authFetch } from '../config/api';
import {
  parseSpecificationsForDisplay,
  specificationsObjectForLogistics
} from '../utils/specifications';
import { formatRupee } from '../utils/formatRupee';
import { getTodayDateInputValue, isDateBeforeToday } from '../utils/dateTime';
import { formatShippingAddressLabel, formatShippingAddressPreview } from '../utils/shippingAddressLabel';
import {
  getGeolocationErrorMessage,
  resolveAddressFromCurrentLocation
} from '../utils/currentLocationAddress';
import {
  formatQuoteMoney,
  getVendorTransportDetail,
  isTransportSelectionReady,
  isTransportSelectionReadyForVendor,
  mergeTransportSelections,
  normalizeTransportSelection,
  getTransportGroupKey,
  buildShippingAddressKey,
  buildTransportGroupId,
  consolidatePoTransportGroups,
  normalizeShippingAddress
} from '../utils/poTransportSelection';
import './Dashboard.css';
import './CreatePO.css';
import './SupplierPlaceOrder.css';

const todayDateMin = getTodayDateInputValue();
import {
  DEFAULT_CHECKOUT_RESERVATION_MINUTES,
  SUPPLIER_UPSTREAM_CHECKOUT_HOLD_EXPIRED_KEY,
  SUPPLIER_UPSTREAM_CART_PATH,
  buildCheckoutHoldExpiredNavState,
  fetchUpstreamCheckoutReservationConfig,
  fetchUpstreamCheckoutReservationStatus,
  formatReservationCountdown,
  getReservationSecondsRemaining,
  isCheckoutHoldExpired,
  isInventoryHoldExpiredApiError,
  markCheckoutHoldExpired,
  readActiveCheckoutReservation,
  releaseUpstreamCheckoutInventory
} from '../utils/upstreamCheckoutReservation';

const SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY = 'supplierUpstreamOrderDraft';
const SUPPLIER_UPSTREAM_RESTORE_FROM_ORDER_KEY = 'supplierUpstreamRestoreFromOrder';

const isBranchComplete = (branch) =>
  ['address', 'city', 'state', 'country'].every((key) => String(branch?.[key] || '').trim()) &&
  String(branch?.zipCode || branch?.pincode || '').trim();

const branchToShippingAddress = (branch) => ({
  line1: String(branch?.address || branch?.line1 || '').trim(),
  city: String(branch?.city || '').trim(),
  state: String(branch?.state || '').trim(),
  pincode: String(branch?.zipCode || branch?.pincode || '').trim(),
  country: String(branch?.country || 'India').trim() || 'India'
});

function AddressFields({ prefix, address, onChange, disabled = false }) {
  const set = (field, value) => onChange({ ...address, [field]: value });
  return (
    <div className="checkout-address-grid">
      <div className="checkout-address-field checkout-address-field--wide">
        <label htmlFor={`${prefix}-line1`}>Street address</label>
        <input
          id={`${prefix}-line1`}
          className="checkout-address-input"
          value={address.line1 || ''}
          onChange={(e) => set('line1', e.target.value)}
          placeholder="Building / street / area"
          disabled={disabled}
        />
      </div>
      <div className="checkout-address-field">
        <label htmlFor={`${prefix}-city`}>City</label>
        <input
          id={`${prefix}-city`}
          className="checkout-address-input"
          value={address.city || ''}
          onChange={(e) => set('city', e.target.value)}
          placeholder="City"
          disabled={disabled}
        />
      </div>
      <div className="checkout-address-field">
        <label htmlFor={`${prefix}-state`}>State</label>
        <input
          id={`${prefix}-state`}
          className="checkout-address-input"
          value={address.state || ''}
          onChange={(e) => set('state', e.target.value)}
          placeholder="State"
          disabled={disabled}
        />
      </div>
      <div className="checkout-address-field">
        <label htmlFor={`${prefix}-pincode`}>PIN code</label>
        <input
          id={`${prefix}-pincode`}
          className="checkout-address-input"
          value={address.pincode || ''}
          onChange={(e) => set('pincode', e.target.value)}
          placeholder="6-digit PIN"
          disabled={disabled}
        />
      </div>
      <div className="checkout-address-field">
        <label htmlFor={`${prefix}-country`}>Country</label>
        <input
          id={`${prefix}-country`}
          className="checkout-address-input"
          value={address.country || ''}
          onChange={(e) => set('country', e.target.value)}
          placeholder="Country"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

const SupplierPlaceOrder = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const goBackToUpstream = () => {
    void releaseCheckoutHold();
    try {
      sessionStorage.setItem(SUPPLIER_UPSTREAM_RESTORE_FROM_ORDER_KEY, '1');
      if (draft) {
        const { checkoutSessionId: _session, reservationExpiresAt: _expires, ...restoreDraft } = draft;
        localStorage.setItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY, JSON.stringify(restoreDraft));
      }
    } catch (_) {
      // Non-fatal.
    }
    navigate('/supplier-upstream');
  };

  const [draft, setDraft] = useState(null);
  const [requiredDate, setRequiredDate] = useState('');
  const [paymentMethod] = useState('vault');
  const [placing, setPlacing] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [walletBalance, setWalletBalance] = useState(0);
  const [loadingWalletBalance, setLoadingWalletBalance] = useState(false);

  const [shippingAddress, setShippingAddress] = useState({
    line1: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India'
  });
  const [billingAddress, setBillingAddress] = useState({
    line1: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India'
  });
  const [deliveryDestination, setDeliveryDestination] = useState('shipping'); // shipping | billing
  const [hasGstin, setHasGstin] = useState(false);
  const [shippingBranches, setShippingBranches] = useState([]);
  const [selectedShippingBranchId, setSelectedShippingBranchId] = useState('');
  const [cartShippingLocked, setCartShippingLocked] = useState(false);
  const [cartShippingLabel, setCartShippingLabel] = useState('');
  const [cartShippingAddressId, setCartShippingAddressId] = useState('');
  const cartShippingLockedRef = useRef(false);
  const [locatingShippingAddress, setLocatingShippingAddress] = useState(false);

  const [selectedTransport, setSelectedTransport] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [reservationExpiresAt, setReservationExpiresAt] = useState('');
  const [reservationSecondsLeft, setReservationSecondsLeft] = useState(0);
  const [reservationExpired, setReservationExpired] = useState(false);
  const [reservationMinutes, setReservationMinutes] = useState(DEFAULT_CHECKOUT_RESERVATION_MINUTES);
  const [reservationBootstrapDone, setReservationBootstrapDone] = useState(false);
  const reservationHoldRef = useRef(false);

  const releaseCheckoutHold = async () => {
    const sessionId = String(draft?.checkoutSessionId || '').trim();
    if (!sessionId) return;
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      await releaseUpstreamCheckoutInventory({ token, checkoutSessionId: sessionId });
    } catch (e) {
      console.error('Failed to release upstream checkout hold:', e);
    }
  };

  const redirectToUpstreamCartAfterHoldExpiry = async (minutes = reservationMinutes) => {
    setReservationExpired(true);
    reservationHoldRef.current = false;
    markCheckoutHoldExpired(SUPPLIER_UPSTREAM_CHECKOUT_HOLD_EXPIRED_KEY);
    await releaseCheckoutHold();
    try {
      localStorage.removeItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
    } catch (_) {
      // Non-fatal.
    }
    setDraft(null);
    navigate(SUPPLIER_UPSTREAM_CART_PATH, {
      replace: true,
      state: buildCheckoutHoldExpiredNavState(minutes)
    });
  };

  const handleReservationExpired = async () => {
    if (reservationExpired || !reservationHoldRef.current) return;
    await redirectToUpstreamCartAfterHoldExpiry();
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;

      if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) return;

      setDraft(parsed);
      setRequiredDate(typeof parsed.requiredDate === 'string' ? parsed.requiredDate : '');
      const expiresAt = typeof parsed.reservationExpiresAt === 'string' ? parsed.reservationExpiresAt : '';
      setReservationExpiresAt(expiresAt);
      reservationHoldRef.current = Boolean(parsed.checkoutSessionId && expiresAt);
      setSelectedTransport(
        parsed.transportSelection && typeof parsed.transportSelection === 'object'
          ? normalizeTransportSelection(parsed.transportSelection)
          : null
      );
      if (parsed.checkoutShippingAddress && typeof parsed.checkoutShippingAddress === 'object') {
        const normalized = normalizeShippingAddress(parsed.checkoutShippingAddress);
        setShippingAddress((prev) => ({
          ...prev,
          ...normalized
        }));
        setCartShippingLocked(true);
        cartShippingLockedRef.current = true;
        setDeliveryDestination('shipping');
        setCartShippingLabel(
          typeof parsed.shippingAddressLabel === 'string' && parsed.shippingAddressLabel.trim()
            ? parsed.shippingAddressLabel.trim()
            : formatShippingAddressPreview(normalized)
        );
        if (parsed.shippingAddressId) {
          setCartShippingAddressId(String(parsed.shippingAddressId));
        }
      } else {
        const lineWithShipping = Array.isArray(parsed.reviewLines)
          ? parsed.reviewLines.find(
              (line) => line?.shippingAddress && typeof line.shippingAddress === 'object'
            )
          : null;
        if (lineWithShipping?.shippingAddress) {
          const normalized = normalizeShippingAddress(lineWithShipping.shippingAddress);
          setShippingAddress((prev) => ({
            ...prev,
            ...normalized
          }));
          setCartShippingLocked(true);
          cartShippingLockedRef.current = true;
          setDeliveryDestination('shipping');
          setCartShippingLabel(formatShippingAddressPreview(normalized));
        }
      }
    } catch (e) {
      console.error('Failed to load supplier upstream order draft:', e);
    } finally {
      setLoadingDraft(false);
    }
  }, []);

  useEffect(() => {
    if (loadingDraft) return undefined;

    let cancelled = false;

    const finishBootstrap = () => {
      if (!cancelled) setReservationBootstrapDone(true);
    };

    (async () => {
      let resolvedMinutes = reservationMinutes;

      if (isCheckoutHoldExpired(SUPPLIER_UPSTREAM_CHECKOUT_HOLD_EXPIRED_KEY)) {
        if (!cancelled) {
          navigate(SUPPLIER_UPSTREAM_CART_PATH, {
            replace: true,
            state: buildCheckoutHoldExpiredNavState(resolvedMinutes)
          });
        }
        return;
      }

      const sessionId = String(draft?.checkoutSessionId || '').trim();
      const token = localStorage.getItem('token');
      if (!sessionId || !token) {
        finishBootstrap();
        return;
      }

      try {
        const config = await fetchUpstreamCheckoutReservationConfig({ token });
        if (!cancelled && Number(config?.expiresInMinutes) > 0) {
          resolvedMinutes = Number(config.expiresInMinutes);
          setReservationMinutes(resolvedMinutes);
        }
      } catch (e) {
        console.error('Failed to load upstream checkout reservation config:', e);
      }

      try {
        const restored = await readActiveCheckoutReservation({
          token,
          checkoutSessionId: sessionId,
          fetchStatus: fetchUpstreamCheckoutReservationStatus
        });
        if (cancelled) return;

        if (restored.active) {
          setReservationExpiresAt(restored.expiresAt);
          setReservationSecondsLeft(restored.secondsLeft || 0);
          setReservationExpired(false);
          reservationHoldRef.current = true;
          setDraft((prev) =>
            prev
              ? {
                  ...prev,
                  reservationExpiresAt: restored.expiresAt
                }
              : prev
          );
        } else {
          markCheckoutHoldExpired(SUPPLIER_UPSTREAM_CHECKOUT_HOLD_EXPIRED_KEY);
          await releaseCheckoutHold();
          try {
            localStorage.removeItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
          } catch (_) {
            // Non-fatal.
          }
          if (!cancelled) {
            navigate(SUPPLIER_UPSTREAM_CART_PATH, {
              replace: true,
              state: buildCheckoutHoldExpiredNavState(resolvedMinutes)
            });
          }
          return;
        }
      } catch (e) {
        console.error('Failed to restore upstream checkout reservation:', e);
        if (!cancelled) {
          const expiresAt =
            typeof draft?.reservationExpiresAt === 'string' ? draft.reservationExpiresAt : '';
          const secondsLeft = getReservationSecondsRemaining(expiresAt);
          if (expiresAt && secondsLeft > 0) {
            setReservationExpiresAt(expiresAt);
            setReservationSecondsLeft(secondsLeft);
            reservationHoldRef.current = true;
          } else {
            markCheckoutHoldExpired(SUPPLIER_UPSTREAM_CHECKOUT_HOLD_EXPIRED_KEY);
            navigate(SUPPLIER_UPSTREAM_CART_PATH, {
              replace: true,
              state: buildCheckoutHoldExpiredNavState(resolvedMinutes)
            });
            return;
          }
        }
      } finally {
        finishBootstrap();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadingDraft, draft?.checkoutSessionId]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return undefined;

    let cancelled = false;
    (async () => {
      try {
        const config = await fetchUpstreamCheckoutReservationConfig({ token });
        if (!cancelled && Number(config?.expiresInMinutes) > 0) {
          setReservationMinutes(Number(config.expiresInMinutes));
        }
      } catch (e) {
        console.error('Failed to load upstream checkout reservation config:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!reservationBootstrapDone || !reservationExpiresAt || reservationExpired || !reservationHoldRef.current) {
      if (!reservationExpiresAt || reservationExpired) {
        setReservationSecondsLeft(0);
      }
      return undefined;
    }

    const tick = () => {
      const secondsLeft = getReservationSecondsRemaining(reservationExpiresAt);
      setReservationSecondsLeft(secondsLeft);
      if (secondsLeft <= 0) {
        void handleReservationExpired();
      }
    };

    tick();
    const timerId = window.setInterval(tick, 1000);
    return () => window.clearInterval(timerId);
  }, [reservationExpiresAt, reservationExpired, reservationBootstrapDone]);

  // Older drafts may lack specs/images — hydrate from current supplier catalog.
  useEffect(() => {
    if (!draft?.lines?.length) return;
    const reviewLines = Array.isArray(draft.reviewLines) ? draft.reviewLines : [];
    const needsHydration = reviewLines.some(
      (line) =>
        !line?.specifications ||
        parseSpecificationsForDisplay(line.specifications, { maxEntries: 1 }).length === 0
    );
    if (!needsHydration) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/supplier/products', { cache: 'no-cache' });
        const data = await res.json();
        if (cancelled || !res.ok || data.status !== 'success') return;

        const byMineId = new Map();
        (data.products || []).forEach((p) => {
          const id = p?.supplier_product_id;
          if (id) byMineId.set(String(id), p);
        });

        const nextReviewLines = reviewLines.map((line) => {
          const mine = byMineId.get(String(line?.mineSupplierProductId || ''));
          if (!mine) return line;
          return {
            ...line,
            productName: line.productName || mine.name,
            specifications: line.specifications || mine.specifications || null,
            images:
              Array.isArray(line?.images) && line.images.length > 0
                ? line.images
                : collectProductImages(mine),
            brandModel: line.brandModel || mine.brandModel || mine.brand || null,
            unit: line.unit || mine.unit || 'units',
            description: line.description || mine.description || ''
          };
        });

        setDraft((prev) => (prev ? { ...prev, reviewLines: nextReviewLines } : prev));
      } catch (e) {
        console.error('Failed to hydrate order line specifications:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draft?.lines, draft?.reviewLines]);

  // Persist user's latest choices so navigating back doesn't lose their inputs.
  useEffect(() => {
    if (!draft) return;
    try {
      localStorage.setItem(
        SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY,
        JSON.stringify({
          ...draft,
          requiredDate: requiredDate || '',
          paymentMethod,
          transportSelection: selectedTransport,
          checkoutShippingAddress: normalizeShippingAddress(shippingAddress),
          deliveryDestination,
          shippingAddressId: cartShippingAddressId || null,
          shippingAddressLabel: cartShippingLabel || formatShippingAddressPreview(shippingAddress),
          shippingAddress: normalizeShippingAddress(shippingAddress),
          billingAddress: normalizeShippingAddress(billingAddress)
        })
      );
    } catch (_) {
      // Non-fatal.
    }
  }, [draft, requiredDate, paymentMethod, selectedTransport, shippingAddress, billingAddress, deliveryDestination, cartShippingAddressId, cartShippingLabel]);

  // Prefill billing address from profile when delivery is not locked to cart selection.
  useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      setProfileLoading(true);
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(getApiUrl('/api/profile'), {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        const profile = data?.profile || {};
        const gstinRaw = profile?.gstin || profile?.mainGstin || '';
        setHasGstin(Boolean(String(gstinRaw || '').trim()));

        if (!cartShippingLockedRef.current) {
          const branches = (Array.isArray(profile?.branches) ? profile.branches : []).filter(isBranchComplete);
          setShippingBranches(branches);
          const primaryBranch = branches[0] || null;
          if (primaryBranch) {
            setSelectedShippingBranchId(String(primaryBranch.id || ''));
            setShippingAddress(branchToShippingAddress(primaryBranch));
          }
        }

        const billingFromProfile = profile?.address || {};
        setBillingAddress((prev) => ({
          ...prev,
          line1: billingFromProfile?.line1 || billingFromProfile?.street || prev.line1,
          city: billingFromProfile?.city || prev.city,
          state: billingFromProfile?.state || prev.state,
          pincode: billingFromProfile?.pincode || billingFromProfile?.zipCode || prev.pincode,
          country: billingFromProfile?.country || prev.country
        }));
      } catch (e) {
        // Non-fatal; user can still fill manually.
        console.error('Supplier profile load error:', e);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  // When returning from Transport suggestion, merge per-supplier picks and restore checkout fields.
  useEffect(() => {
    const routeState = location.state || {};
    const incomingTransport =
      routeState.transportSelection && typeof routeState.transportSelection === 'object'
        ? routeState.transportSelection
        : null;

    if (incomingTransport) {
      setSelectedTransport((prev) =>
        normalizeTransportSelection(mergeTransportSelections(prev, incomingTransport))
      );
    }

    if (typeof routeState.deliveryDestination === 'string') {
      if (routeState.deliveryDestination === 'shipping' || routeState.deliveryDestination === 'billing') {
        setDeliveryDestination(routeState.deliveryDestination);
      }
    }

    if (routeState.hasGstin != null) setHasGstin(Boolean(routeState.hasGstin));

    if (routeState.shippingAddress && typeof routeState.shippingAddress === 'object' && !cartShippingLockedRef.current) {
      setShippingAddress((prev) => ({ ...prev, ...routeState.shippingAddress }));
    }
    if (routeState.billingAddress && typeof routeState.billingAddress === 'object') {
      setBillingAddress((prev) => ({ ...prev, ...routeState.billingAddress }));
    }

    if (typeof routeState.requiredDate === 'string') setRequiredDate(routeState.requiredDate || '');

    if (incomingTransport) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    // Backend also forces delivery to shipping when GSTIN is not available.
    if (!hasGstin && deliveryDestination === 'billing') setDeliveryDestination('shipping');
  }, [hasGstin, deliveryDestination]);

  useEffect(() => {
    if (cartShippingLocked || cartShippingLockedRef.current) return;
    if (!selectedShippingBranchId) return;
    const branch = shippingBranches.find((b) => String(b.id) === String(selectedShippingBranchId));
    if (branch) setShippingAddress(branchToShippingAddress(branch));
  }, [selectedShippingBranchId, shippingBranches, cartShippingLocked]);

  const fillShippingFromCurrentLocation = async () => {
    setLocatingShippingAddress(true);
    try {
      const resolved = await resolveAddressFromCurrentLocation();
      setSelectedShippingBranchId('');
      setShippingAddress({
        line1: resolved.line1 || '',
        city: resolved.city || '',
        state: resolved.state || '',
        pincode: resolved.pincode || '',
        country: resolved.country || 'India'
      });
    } catch (error) {
      alert(getGeolocationErrorMessage(error));
    } finally {
      setLocatingShippingAddress(false);
    }
  };

  const itemCount = useMemo(() => {
    if (!draft?.lines || !Array.isArray(draft.lines)) return 0;
    return draft.lines.length;
  }, [draft]);

  const estimatedTotal = useMemo(() => {
    const v = draft?.totalAmountEstimate;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }, [draft]);

  const todayDateInput = todayDateMin;

  const reviewLines = useMemo(
    () => (Array.isArray(draft?.reviewLines) ? draft.reviewLines : []),
    [draft]
  );

  const poGroups = useMemo(() => {
    const effectiveDeliveryAddress = normalizeShippingAddress(
      deliveryDestination === 'billing' && hasGstin ? billingAddress : shippingAddress
    );
    const groupsByTransportKey = new Map();

    for (const line of reviewLines || []) {
      const vendorId = line?.supplierId != null ? String(line.supplierId).trim() : '';
      const vendorName = line?.supplierName ? String(line.supplierName) : 'Supplier';
      if (!vendorId) continue;

      const lineShipping =
        line?.shippingAddress && typeof line.shippingAddress === 'object'
          ? normalizeShippingAddress(line.shippingAddress)
          : effectiveDeliveryAddress;
      const transportGroupId = buildTransportGroupId(vendorId, lineShipping);
      const shippingAddressLabel = formatShippingAddressPreview(lineShipping);

      if (!groupsByTransportKey.has(transportGroupId)) {
        groupsByTransportKey.set(transportGroupId, {
          vendorId,
          transportGroupId,
          shippingAddressKey: buildShippingAddressKey(lineShipping),
          shippingAddress: { ...lineShipping },
          shippingAddressLabel,
          vendorName,
          total: 0,
          items: []
        });
      }

      const g = groupsByTransportKey.get(transportGroupId);
      if (!g.vendorName && vendorName) g.vendorName = vendorName;
      const qty = Number(line?.quantity || 0) || 0;
      const unitPrice = Number(line?.unitPrice || 0) || 0;
      const lineTotal = Number(line?.lineTotal ?? qty * unitPrice) || 0;

      g.total += lineTotal;
      g.items.push({
        name: line?.productName || 'Product',
        quantity: qty,
        unit: line?.unit || 'nos',
        price: unitPrice,
        specifications: specificationsObjectForLogistics(line?.specifications),
        images: Array.isArray(line?.images) ? line.images : []
      });
    }

    return consolidatePoTransportGroups(Array.from(groupsByTransportKey.values()));
  }, [reviewLines, shippingAddress, billingAddress, deliveryDestination, hasGstin]);

  const grandTotalAllPos = useMemo(() => {
    if (!poGroups.length) return 0;
    return poGroups.reduce((s, g) => s + (Number(g.total) || 0), 0);
  }, [poGroups]);
  const walletShortage = Math.max(0, Number(grandTotalAllPos || 0) - Number(walletBalance || 0));
  const hasSufficientWalletBalance = walletShortage <= 0;

  useEffect(() => {
    let cancelled = false;
    const loadWalletBalance = async () => {
      setLoadingWalletBalance(true);
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const resp = await fetch(getApiUrl('/api/supplier/wallet/balance'), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-cache'
        });
        const data = await resp.json().catch(() => ({}));
        if (cancelled || !resp.ok || data.status !== 'success') return;
        setWalletBalance(Number(data.balance || data.wallet?.balance || 0));
      } finally {
        if (!cancelled) setLoadingWalletBalance(false);
      }
    };
    void loadWalletBalance();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTransportSuggestion = (group) => {
    if (placing) return;

    if (!requiredDate) {
      window.alert('Please select an expected dispatch date before getting transport suggestions.');
      return;
    }
    if (isDateBeforeToday(requiredDate)) {
      window.alert('Expected dispatch date cannot be in the past.');
      return;
    }

    if (!poGroups.length) {
      window.alert('No vendor groups found for transport suggestion.');
      return;
    }

    const missingSupplierIds = (reviewLines || []).some((l) => !l?.supplierId);
    if (missingSupplierIds) {
      window.alert(
        'Some selected lines are missing supplier information. Please go back to Upstream Orders and re-select items.'
      );
      return;
    }

    const scopedGroups = group ? [group] : poGroups;
    const focusTransportGroupId = group ? getTransportGroupKey(group) : '';
    const baseTransport = normalizeTransportSelection(selectedTransport);

    const missingShipping = ['line1', 'city', 'state', 'pincode', 'country'].find(
      (key) => !String(shippingAddress?.[key] || '').trim()
    );
    if (missingShipping) {
      window.alert('Please complete the shipping address before transport suggestions.');
      return;
    }
    if (hasGstin) {
      const missingBilling = ['line1', 'city', 'state', 'pincode', 'country'].find(
        (key) => !String(billingAddress?.[key] || '').trim()
      );
      if (missingBilling) {
        window.alert('Please complete the billing address before transport suggestions.');
        return;
      }
    }

    navigate('/supplier-transport-suggestion', {
      state: {
        returnPath: '/supplier-place-order',
        poGroups: scopedGroups,
        allPoGroups: poGroups,
        focusTransportGroupId,
        focusVendorId: focusTransportGroupId,
        existingTransportSelection: baseTransport,
        grandTotalAllPos: group ? Number(group.total) || 0 : grandTotalAllPos,
        requiredDate,
        hasGstin,
        deliveryDestination,
        shippingAddress,
        shippingAddressId: cartShippingAddressId || null,
        billingAddress,
        createdOrders: []
      }
    });
  };

  const handlePlaceOrder = async () => {
    if (!draft?.lines || !Array.isArray(draft.lines) || draft.lines.length === 0) {
      alert('No draft order found. Please select products again.');
      return;
    }
    if (!draft?.checkoutSessionId) {
      alert('This order draft is missing an inventory hold. Go back to upstream sourcing and proceed again.');
      return;
    }
    if (!reservationHoldRef.current || reservationExpired || reservationSecondsLeft <= 0) {
      await redirectToUpstreamCartAfterHoldExpiry();
      return;
    }

    if (loadingWalletBalance) {
      alert('Checking your vault balance. Please wait a moment.');
      return;
    }
    if (!hasSufficientWalletBalance) {
      alert(
        `Insufficient vault balance. Please add ${formatRupee(walletShortage)} to your supplier vault and try again.`
      );
      return;
    }

    if (!requiredDate) {
      const proceed = window.confirm(
        'You have not specified an expected dispatch date.\n\nDo you want to continue without an expected dispatch date?'
      );
      if (!proceed) return;
    } else if (isDateBeforeToday(requiredDate)) {
      window.alert('Expected dispatch date cannot be in the past.');
      return;
    }

    if (!isTransportSelectionReady(selectedTransport, poGroups)) {
      alert('Please select transport for each upstream supplier before placing the order.');
      return;
    }

    setPlacing(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/orders'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          lines: draft.lines,
          checkoutSessionId: draft.checkoutSessionId,
          requiredDate: requiredDate || null,
          paymentMethod,
          shippingAddress,
          shippingAddressId: cartShippingAddressId || null,
          billingAddress,
          deliveryDestination
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.status !== 'success') {
        if (isInventoryHoldExpiredApiError(data)) {
          await redirectToUpstreamCartAfterHoldExpiry();
          return;
        }
        alert(data?.message || 'Failed to place upstream orders.');
        return;
      }

      const createdOrders = Array.isArray(data.orders) ? data.orders : [];

      // If the user picked transport quotes, book the chosen transport against created orders.
      if (selectedTransport && createdOrders.length > 0 && selectedTransport.byVendorId) {
        const perOrderTransport = createdOrders.map((o) => {
          const transportKey = String(o.transportGroupId || o.supplierId || '').trim();
          const shippingProvider =
            selectedTransport?.byVendorId?.[transportKey] ||
            selectedTransport?.byVendorId?.[String(o.supplierId || '')];
          const det =
            selectedTransport?.byVendorCourierDetail?.[transportKey] ||
            selectedTransport?.byVendorCourierDetail?.[String(o.supplierId || '')] ||
            {};

          const transportMode = det?.transport_mode ?? det?.transportMode ?? null;
          const source = det?.source ?? null;
          const shippingProviderName = String(shippingProvider || '').trim().toLowerCase();
          const isSelfShip =
            String(transportMode || '').toLowerCase() === 'self_ship' ||
            shippingProviderName === 'self ship' ||
            shippingProviderName === 'self-ship';
          const isTrucking = String(transportMode || '').toLowerCase() === 'trucking';

          return {
            orderId: o.id,
            shippingProvider: String(shippingProvider || '').trim(),
            courierCompanyId: isSelfShip || isTrucking ? null : det?.courier_company_id ?? null,
            vehicleTypeId: isSelfShip ? null : isTrucking ? det?.vehicle_type_id ?? det?.vehicleTypeId ?? null : null,
            transportMode: isSelfShip ? 'self_ship' : isTrucking ? 'trucking' : 'courier',
            source: isSelfShip ? 'self_ship' : source ? String(source) : null,
            weightKg: det?.weightKg ?? null,
            pickupLat: det?.pickup_lat ?? det?.pickupLat ?? null,
            pickupLng: det?.pickup_lng ?? det?.pickupLng ?? null,
            deliveryLat: det?.delivery_lat ?? det?.deliveryLat ?? null,
            deliveryLng: det?.delivery_lng ?? det?.deliveryLng ?? null,
            carrier: det?.carrier ?? null,
            matter: null,
            trackingNumber: null,
            trackingUrl: null,
            transportNotes: null,
            quotedTransportAmount: det?.fareValue ?? det?.rate ?? null
          };
        });

        const confirmRes = await fetch(getApiUrl('/api/po/transport/confirm'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            orderIds: createdOrders.map((o) => o.id).filter(Boolean),
            perOrderTransport
          })
        });

        const confirmData = await confirmRes.json().catch(() => ({}));
        if (!confirmRes.ok || confirmData?.status !== 'success') {
          alert(confirmData?.message || 'Upstream order(s) created, but transport selection failed.');
          localStorage.removeItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
          navigate('/supplier-upstream-orders');
          return;
        }

        // Vault debit first — logistics book/tracking only after payment succeeds.
        for (const order of createdOrders) {
          if (!order?.id) continue;
          const payRes = await fetch(getApiUrl(`/api/supplier/wallet/orders/${encodeURIComponent(order.id)}/pay`), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              idempotencyKey: `supplier-place-vault-${order.id}`
            })
          });
          const payData = await payRes.json().catch(() => ({}));
          const alreadyPaid =
            payData?.code === 'ORDER_ALREADY_PAID' || /already paid/i.test(String(payData?.message || ''));
          if ((!payRes.ok || payData?.status !== 'success') && !alreadyPaid) {
            alert(
              payData?.message ||
                `Order(s) created and transport saved, but vault payment failed for ${order.orderNumber || order.id}. Tracking will not be booked until payment succeeds.`
            );
            localStorage.removeItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
            navigate('/supplier-upstream-orders');
            return;
          }
        }

        const bookRes = await fetch(getApiUrl('/api/po/transport/confirm'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            orderIds: createdOrders.map((o) => o.id).filter(Boolean),
            perOrderTransport
          })
        });
        const bookData = await bookRes.json().catch(() => ({}));
        if (!bookRes.ok || bookData?.status !== 'success') {
          alert(bookData?.message || 'Paid, but carrier booking failed. Tracking can be retried later.');
          localStorage.removeItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
          navigate('/supplier-upstream-orders');
          return;
        }
      }

      alert(data.message || 'Upstream order(s) placed successfully.');
      localStorage.removeItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
      navigate('/supplier-upstream-orders');
    } catch (e) {
      console.error('Place upstream orders error:', e);
      alert(e?.message || 'Failed to place upstream orders. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  if (loadingDraft) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading your order draft…</p>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-header">
          <div>
            <h1>Place Order</h1>
            <p>No order draft found. Start from Upstream Orders.</p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => navigate('/supplier-upstream')}>
            Back to Upstream Orders
          </button>
        </div>
      </div>
    );
  }

  if (!draft.checkoutSessionId) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-header">
          <div>
            <h1>Place Order</h1>
            <p>This draft is out of date. Return to upstream sourcing and proceed to checkout again.</p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => navigate('/supplier-upstream')}>
            Back to Upstream Sourcing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container spo-page">
      <div className="dashboard-header">
        <div>
          <h1>Place Upstream Order</h1>
          <p style={{ color: '#64748b', margin: '0.35rem 0 0', maxWidth: '36rem' }}>
            Review delivery, payment, and transport — then confirm your upstream purchase.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={goBackToUpstream}>
          Back
        </button>
      </div>

      {reservationBootstrapDone && !reservationExpired && reservationSecondsLeft > 0 ? (
      <div
        className={`spo-reservation-banner ${
          reservationSecondsLeft > 0 && reservationSecondsLeft <= 120 ? 'spo-reservation-banner--warning' : ''
        }`}
      >
        <div>
          <strong>Inventory held for checkout</strong>
          <p>
            Upstream stock is reserved for you for {reservationMinutes} minutes to prevent
            overselling. Complete your order before the timer ends or stock will be released automatically.
          </p>
        </div>
        <div className="spo-reservation-timer" aria-live="polite">
          {formatReservationCountdown(reservationSecondsLeft)}
        </div>
      </div>
      ) : null}

      <div className="spo-layout">
        <div className="spo-summary-bar">
          <h2 className="spo-summary-bar__title">Order summary</h2>
          <div className="spo-summary-stats">
            <div className="spo-stat">
              <span className="spo-stat__label">Items</span>
              <span className="spo-stat__value">{itemCount}</span>
            </div>
            {estimatedTotal != null ? (
              <div className="spo-stat">
                <span className="spo-stat__label">Est. total</span>
                <span className="spo-stat__value spo-stat__value--accent">
                  {formatRupee(estimatedTotal)}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="spo-card">
          <section className="spo-section">
            <h2 className="spo-section-title">Delivery &amp; payment</h2>
            <div className="spo-two-col">
              <div className="spo-field">
                <label htmlFor="spo-required-date">Expected dispatch date</label>
                <input
                  id="spo-required-date"
                  type="date"
                  value={requiredDate}
                  onChange={(e) => {
                    setRequiredDate(e.target.value);
                  }}
                  min={todayDateInput}
                />
                <p className="spo-hint">Stored on each upstream order as the expected dispatch date.</p>
              </div>
              <div className="spo-field">
                <label htmlFor="spo-payment-method">Payment method</label>
                <input id="spo-payment-method" value="Vault only" readOnly />
                <p className="spo-hint">
                  Upstream purchases are vault-only. Credit supplier vault first, then place/pay orders.
                </p>
              </div>
            </div>
            <div className="spo-alert" style={{ marginTop: '0.75rem' }}>
              <strong>Vault readiness:</strong> Order total {formatRupee(grandTotalAllPos)} | Vault balance{' '}
              {loadingWalletBalance ? 'Loading…' : formatRupee(walletBalance)}.
              {!loadingWalletBalance && !hasSufficientWalletBalance ? (
                <>
                  {' '}
                  Need {formatRupee(walletShortage)} more.
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ marginLeft: '0.6rem' }}
                    onClick={() => navigate('/supplier-wallet')}
                  >
                    Credit vault
                  </button>
                </>
              ) : null}
            </div>
          </section>

          <section className="spo-section">
            <h2 className="spo-section-title">Delivery address</h2>
            {cartShippingLocked ? (
              <>
                <p className="spo-section-desc">
                  This is the address you selected when adding items to your upstream cart. It is used for courier
                  quotes and delivery.
                </p>
                <div className="spo-address-single checkout-address-card">
                  <div className="checkout-address-card__head">
                    <h3>Cart delivery address</h3>
                    <p>Material will be delivered to this location.</p>
                  </div>
                  {cartShippingLabel ? (
                    <p className="spo-cart-shipping-label" style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                      {cartShippingLabel}
                    </p>
                  ) : null}
                  <p className="checkout-address-note" style={{ marginBottom: 0 }}>
                    {formatShippingAddressPreview(shippingAddress)}
                  </p>
                  <p className="spo-hint" style={{ marginTop: '0.75rem' }}>
                    To change this address, go back to Upstream and update the shipping address on your cart project.
                  </p>
                </div>
              </>
            ) : (
              <>
                <p className="spo-section-desc">
                  Choose where material should be delivered. Only the selected address is shown and used for courier
                  quotes.
                </p>

                <div className="checkout-delivery-choice" style={{ marginBottom: '1rem' }}>
                  <label>
                    <input
                      type="radio"
                      name="spo-delivery-dest"
                      checked={deliveryDestination === 'shipping'}
                      onChange={() => setDeliveryDestination('shipping')}
                    />
                    Shipping branch address
                  </label>
                  <label style={!hasGstin ? { opacity: 0.55 } : undefined}>
                    <input
                      type="radio"
                      name="spo-delivery-dest"
                      checked={deliveryDestination === 'billing'}
                      disabled={!hasGstin}
                      onChange={() => hasGstin && setDeliveryDestination('billing')}
                    />
                    Billing address {hasGstin ? '' : '(add GSTIN in profile)'}
                  </label>
                </div>

                {deliveryDestination === 'shipping' ? (
                  <div className="spo-address-single checkout-address-card">
                    <div className="checkout-address-card__head">
                      <h3>Shipping (branch)</h3>
                      <p>Material will be delivered to this branch location.</p>
                    </div>
                    {shippingBranches.length > 1 ? (
                      <div className="spo-field" style={{ marginBottom: '0.75rem' }}>
                        <label htmlFor="spo-shipping-branch">Branch</label>
                        <select
                          id="spo-shipping-branch"
                          value={selectedShippingBranchId}
                          onChange={(e) => setSelectedShippingBranchId(e.target.value)}
                        >
                          {shippingBranches.map((branch) => (
                            <option key={branch.id} value={String(branch.id)}>
                              {branch.name || 'Branch'} — {branch.city || 'City'}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    <p className="checkout-address-note">
                      From Company Profile → shipping branches.{' '}
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem', marginLeft: '0.25rem' }}
                        onClick={() => navigate('/profile')}
                      >
                        Edit profile
                      </button>
                    </p>
                    <div className="checkout-address-location-row">
                      <button
                        type="button"
                        className="checkout-location-btn"
                        onClick={fillShippingFromCurrentLocation}
                        disabled={locatingShippingAddress}
                      >
                        <MapPin size={15} aria-hidden />
                        {locatingShippingAddress ? 'Detecting location…' : 'Use my current location'}
                      </button>
                    </div>
                    <AddressFields
                      prefix="ship"
                      address={shippingAddress}
                      onChange={setShippingAddress}
                    />
                  </div>
                ) : (
                  <div className="spo-address-single checkout-address-card checkout-address-card--billing">
                    <div className="checkout-address-card__head">
                      <h3>Billing address</h3>
                      <p>Material will be delivered to this billing address (GSTIN on file).</p>
                    </div>
                    <p className="checkout-address-note">
                      From Company Profile → registered billing address.{' '}
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem', marginLeft: '0.25rem' }}
                        onClick={() => navigate('/profile')}
                      >
                        Edit profile
                      </button>
                    </p>
                    <AddressFields
                      prefix="bill"
                      address={billingAddress}
                      onChange={setBillingAddress}
                      disabled
                    />
                  </div>
                )}
              </>
            )}
          </section>

          {poGroups.length > 0 ? (
            <>
              <section className="spo-section">
                <h2 className="spo-section-title">Upstream suppliers</h2>
                <p className="spo-section-desc">
                  Items from the same upstream supplier going to the same delivery address are clubbed into one
                  shipment. Choose transport once per group before placing the order.
                </p>
                <div className="po-list">
                  {poGroups.map((group) => (
                    <div key={getTransportGroupKey(group)} className="po-card">
                      <div className="po-header">
                        <div>
                          <h3>{group.vendorName}</h3>
                          {group.items?.length > 1 ? (
                            <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: '#475569' }}>
                              {group.items.length} items · one shared transport for this supplier
                            </p>
                          ) : null}
                          {group.shippingAddressLabel ? (
                            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                              Delivery: {group.shippingAddressLabel}
                            </p>
                          ) : null}
                        </div>
                        <div className="po-total">{formatRupee(group.total || 0)}</div>
                      </div>
                      <table className="po-table">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Quantity</th>
                            <th>Unit price</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items?.map((item, idx) => {
                            const specEntries = parseSpecificationsForDisplay(item?.specifications, {
                              maxEntries: 8
                            });
                            const images = Array.isArray(item?.images) ? item.images.filter(Boolean) : [];
                            return (
                              <tr key={`${group.vendorId}-${idx}`}>
                                <td>
                                  {images.length > 0 ? (
                                    <div style={{ marginBottom: '0.35rem' }}>
                                      <ProductImageCarousel
                                        images={images}
                                        alt={item.name || 'Product'}
                                        height={72}
                                        rounded={8}
                                      />
                                    </div>
                                  ) : null}
                                  <div>{item.name}</div>
                                  {specEntries.length > 0 ? (
                                    <div className="spo-line-specs" style={{ marginTop: '0.4rem' }}>
                                      {specEntries.map((entry) => (
                                        <span
                                          key={`${entry.label}-${entry.value}`}
                                          className="spo-line-spec-pill"
                                          title={`${entry.label}: ${entry.value}`}
                                        >
                                          <strong>{entry.label}:</strong> {entry.value}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                </td>
                                <td>
                                  {item.quantity} {item.unit || ''}
                                </td>
                                <td>{formatRupee(item.price || 0)}</td>
                                <td>{formatRupee((item.quantity || 0) * (item.price || 0))}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="po-transport-actions">
                        {isTransportSelectionReadyForVendor(selectedTransport, group) ? (
                          <div className="po-transport-status">
                            <span className="po-transport-status__label">Transport selected</span>
                            {(() => {
                              const transportKey = getTransportGroupKey(group);
                              const d = getVendorTransportDetail(selectedTransport, group);
                              const priceLabel = formatQuoteMoney(d?.rate ?? d?.fareValue);
                              const modeLabel =
                                d?.transport_mode === 'self_ship' || d?.transportMode === 'self_ship'
                                  ? 'Self ship'
                                  : d?.transport_mode === 'trucking' || d?.transportMode === 'trucking'
                                    ? 'Trucking'
                                    : 'Courier';
                              const carrierName =
                                d?.name || selectedTransport?.byVendorId?.[transportKey];
                              return (
                                <span className="po-transport-status__detail">
                                  <span className="po-transport-status__mode">{modeLabel}:</span>
                                  <span className="po-transport-status__name">{carrierName}</span>
                                  {priceLabel ? (
                                    <span className="po-transport-status__price">{priceLabel}</span>
                                  ) : null}
                                </span>
                              );
                            })()}
                          </div>
                        ) : (
                          <p className="po-transport-status po-transport-status--pending">
                            No transport selected for this supplier yet.
                          </p>
                        )}
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => handleTransportSuggestion(group)}
                          disabled={placing || profileLoading}
                        >
                          Transport suggestion
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {isTransportSelectionReady(selectedTransport, poGroups) ? (
                <section className="spo-section">
                  <div className="po-transport-summary">
                    <div className="po-transport-summary__title">
                      Selected transport (review rates, then place order below)
                    </div>
                    <div className="po-transport-summary__grid">
                      {Object.entries(selectedTransport.byVendorId || {})
                        .filter(([, name]) => String(name || '').trim())
                        .map(([vid, name]) => {
                          const g =
                            poGroups.find((x) => getTransportGroupKey(x) === String(vid)) ||
                            poGroups.find((x) => String(x.vendorId) === String(vid));
                          const label = g?.vendorName || vid;
                          const d =
                            selectedTransport.byVendorCourierDetail &&
                            typeof selectedTransport.byVendorCourierDetail === 'object'
                              ? selectedTransport.byVendorCourierDetail[vid]
                              : null;
                          const priceLabel = formatQuoteMoney(d?.rate ?? d?.fareValue);
                          const modeLabel =
                            d?.transport_mode === 'self_ship' || d?.transportMode === 'self_ship'
                              ? 'Self ship'
                              : d?.transport_mode === 'trucking' || d?.transportMode === 'trucking'
                                ? 'Trucking'
                                : 'Courier';
                          return (
                            <div key={vid} className="po-transport-summary-item">
                              <div className="po-transport-summary-item__vendor">{label}</div>
                              <div className="po-transport-summary-item__detail">
                                <span className="po-transport-status__mode">{modeLabel}:</span>
                                <span className="po-transport-status__name">{name}</span>
                                {priceLabel ? (
                                  <span className="po-transport-status__price">{priceLabel}</span>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          <footer className="spo-actions">
            <button type="button" className="btn-secondary" onClick={goBackToUpstream} disabled={placing}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-large"
              onClick={handlePlaceOrder}
              disabled={
                placing ||
                loadingWalletBalance ||
                !hasSufficientWalletBalance ||
                poGroups.length === 0 ||
                !isTransportSelectionReady(selectedTransport, poGroups)
              }
            >
              {placing
                ? 'Placing…'
                : loadingWalletBalance
                  ? 'Checking vault…'
                  : !isTransportSelectionReady(selectedTransport, poGroups)
                    ? 'Select transport for all suppliers'
                    : !hasSufficientWalletBalance
                      ? 'Insufficient vault balance'
                      : 'Place order'}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default SupplierPlaceOrder;

