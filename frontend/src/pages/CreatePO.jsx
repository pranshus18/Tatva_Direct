import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, Package, X } from 'lucide-react';
import SpWorkflowPage from '../components/sp/SpWorkflowPage';
import { useLocation, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { API_BASE_URL, getApiUrl, resolveApiPath, buildAuthHeaders } from '../config/api';
import { getVaultBalanceForUi, payOrderFromVault } from '../services/vaultService';
import ProductImageCarousel from '../components/ProductImageCarousel';
import SupplierTsinLine from '../components/SupplierTsinLine';
import VoiceGuidedBanner from '../components/VoiceGuidedBanner';
import { fetchVoiceCartDraft, isVoiceGuidedActive, resolveWorkflowShippingAddress } from '../voice/voiceCartBridge';
import { readSupplierSelectBoqProjectSessionIfFresh } from '../constants/supplierSelectSession';
import {
  formatQuoteMoney,
  getVendorTransportDetail,
  isTransportSelectionReady,
  isTransportSelectionReadyForVendor,
  mergeTransportSelections,
  normalizeTransportSelection,
  getTransportGroupKey
} from '../utils/poTransportSelection';
import {
  clearCartTransportSelection
} from '../utils/poCartTransportApi';
import { formatShippingAddressPreview } from '../utils/shippingAddressLabel';
import {
  buildPoReservationLinesFromGroups,
  buildStableReservationLineSignature,
  buildCheckoutHoldExpiredNavState,
  clearCheckoutHoldExpired,
  createCheckoutSessionId,
  DEFAULT_CHECKOUT_RESERVATION_MINUTES,
  fetchPoCheckoutReservationConfig,
  fetchPoCheckoutReservationStatus,
  formatReservationCountdown,
  getReservationSecondsRemaining,
  isCheckoutHoldExpired,
  isInventoryHoldExpiredApiError,
  markCheckoutHoldExpired,
  readActiveCheckoutReservation,
  releasePoCheckoutInventory,
  reservePoCheckoutInventory,
  SP_PO_CHECKOUT_HOLD_EXPIRED_KEY,
  SP_PO_CHECKOUT_SESSION_KEY,
  SP_CHECKOUT_CART_PATH
} from '../utils/checkoutReservation';
import { getTodayDateInputValue, isDateBeforeToday } from '../utils/dateTime';
import {
  isVaultPaymentMethod,
  VAULT_PAGE_PATH,
  VAULT_PAYMENT_METHOD
} from '../utils/vaultPaymentMethod';
import './CreatePO.css';

const todayDateMin = getTodayDateInputValue();

/** Shown when pay-later is blocked (limit, cycle, or minimum). */
const PAY_LATER_UNAVAILABLE_MESSAGE =
  'Pay later is unavailable. You can place the order with a different mode of payment.';
const PAY_LATER_LIMIT_CHECK_FAILED_MESSAGE =
  'Unable to verify pay-later limit right now. Please retry in a few seconds.';

/** UPI intent for platform collection QR. Requires `VITE_PLATFORM_UPI_VPA` in production builds. */
function buildTestPlatformPaymentPayload(grandTotal) {
  const configuredVpa = String(import.meta.env.VITE_PLATFORM_UPI_VPA || '').trim().toLowerCase();
  const vpa =
    configuredVpa ||
    (import.meta.env.PROD ? '' : 'pranshu.platform@upi');
  if (!vpa) {
    return null;
  }
  const payeeName = String(
    import.meta.env.VITE_PLATFORM_UPI_PAYEE_NAME || 'Tatva Direct'
  ).trim();
  const amt = Math.max(0, Number(grandTotal) || 0).toFixed(2);
  const note = import.meta.env.PROD ? 'B2B PO platform payment' : 'B2B PO platform payment (TEST)';
  return `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payeeName || 'Merchant')}&am=${amt}&cu=INR&tn=${encodeURIComponent(note)}`;
}

const blankAddress = {
  line1: '',
  city: '',
  state: '',
  pincode: '',
  country: ''
};

const normalizeAddress = (address = {}) => ({
  line1: String(address?.line1 || address?.street || '').trim(),
  city: String(address?.city || '').trim(),
  state: String(address?.state || '').trim(),
  pincode: String(
    address?.pincode || address?.zipCode || address?.postalCode || address?.postal_code || ''
  ).trim(),
  country: String(address?.country || '').trim()
});


const isUsableShippingAddress = (address = {}) => {
  const normalized = normalizeAddress(address);
  return ['line1', 'city', 'state', 'pincode'].every((key) => String(normalized[key] || '').trim());
};
const normalizeSpecifications = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const seen = new Set();
  return Object.entries(value)
    .map(([key, rawValue]) => [String(key || '').trim(), rawValue])
    .filter(([key, rawValue]) => key && rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '')
    .reduce((acc, [key, rawValue]) => {
      const dedupeKey = key.toLowerCase();
      if (seen.has(dedupeKey)) return acc;
      seen.add(dedupeKey);
      acc.push([key, String(rawValue).trim()]);
      return acc;
    }, []);
};

/** Align workflow lines with cart project shipping addresses for shipment grouping. */
async function enrichItemsWithCartShipping(workflowItems, fallbackShipping = null) {
  if (!Array.isArray(workflowItems) || workflowItems.length === 0) return workflowItems;
  const token = localStorage.getItem('token');
  const lineToShipping = new Map();
  const productToShipping = new Map();
  const fallback = isUsableShippingAddress(fallbackShipping)
    ? normalizeAddress(fallbackShipping)
    : null;

  const mapCartRow = (row, addr) => {
    if (!isUsableShippingAddress(addr)) return;
    const normalized = normalizeAddress(addr);
    const lineId = String(row?.id ?? '').trim();
    if (lineId) lineToShipping.set(lineId, normalized);
    const productId = String(row?.productId ?? '').trim();
    if (productId) productToShipping.set(productId, normalized);
  };

  if (token) {
    try {
      const res = await fetch(getApiUrl('/api/po/cart'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data?.status === 'success' && data.cart?.draft) {
        const draft = data.cart.draft;
        const rootAddr = isUsableShippingAddress(draft.shippingAddress)
          ? normalizeAddress(draft.shippingAddress)
          : fallback;
        const groups = Array.isArray(draft.boqGroups) ? draft.boqGroups : [];
        for (const group of groups) {
          const projectAddr = group?.boqProject?.shippingAddress;
          const addr = isUsableShippingAddress(projectAddr)
            ? normalizeAddress(projectAddr)
            : rootAddr;
          for (const row of group.items || []) {
            mapCartRow(row, addr);
          }
        }
        for (const row of Array.isArray(draft.items) ? draft.items : []) {
          mapCartRow(row, rootAddr);
        }
      }
    } catch {
      // Non-fatal — default shipping still applies below.
    }
  }

  return workflowItems.map((it) => {
    const id = it?.id !== undefined && it?.id !== null ? String(it.id).trim() : '';
    const productId = String(it?.productId ?? '').trim();
    const shippingAddress =
      (id && lineToShipping.get(id)) ||
      (productId && productToShipping.get(productId)) ||
      fallback;
    if (!isUsableShippingAddress(shippingAddress)) return it;
    return { ...it, shippingAddress: normalizeAddress(shippingAddress) };
  });
}

/** Align workflow line quantities with the persisted PO cart (source of truth after cart edits). */
async function mergeWorkflowItemsWithSavedCart(workflowItems, fallbackShipping = null) {
  if (!Array.isArray(workflowItems) || workflowItems.length === 0) return workflowItems;
  const withShipping = await enrichItemsWithCartShipping(workflowItems, fallbackShipping);
  const token = localStorage.getItem('token');
  if (!token) return withShipping;
  try {
    const res = await fetch(getApiUrl('/api/po/cart'), {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success' || !data.cart?.draft) {
      return withShipping;
    }
    const cartItems = Array.isArray(data.cart.draft.items) ? data.cart.draft.items : [];
    if (cartItems.length === 0) return withShipping;
    const qtyByLineId = new Map();
    for (const row of cartItems) {
      if (row?.id === undefined || row?.id === null) continue;
      const key = String(row.id).trim();
      if (!key) continue;
      const q = Number(row.quantity);
      if (Number.isFinite(q) && q >= 1) {
        qtyByLineId.set(key, Math.floor(q));
      }
    }
    if (qtyByLineId.size === 0) return withShipping;
    return withShipping.map((it) => {
      const id = it?.id !== undefined && it?.id !== null ? String(it.id).trim() : '';
      if (!id || !qtyByLineId.has(id)) return it;
      const q = qtyByLineId.get(id);
      return { ...it, quantity: q };
    });
  } catch {
    return withShipping;
  }
}

const CreatePO = ({ selectedVendors, substitutions, boqId, boqProject, items }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const voiceGuided = isVoiceGuidedActive();
  /** Voice navigation passes a draft snapshot; use it on first paint so we do not flash "upload BOQ" before /api/po/cart returns. */
  const navVoiceCart =
    location.state?.voiceCart && typeof location.state.voiceCart === 'object'
      ? location.state.voiceCart
      : null;
  const [voiceCart, setVoiceCart] = useState(navVoiceCart);
  /** False until we know persisted cart + navigation snapshot have been applied (avoids BOQ-only errors for cart / voice checkout). */
  const [cartContextReady, setCartContextReady] = useState(() => {
    const hasPropItems = Array.isArray(items) && items.length > 0;
    const navHasItems =
      navVoiceCart && Array.isArray(navVoiceCart.items) && navVoiceCart.items.length > 0;
    return hasPropItems || navHasItems;
  });
  const [poGroups, setPoGroups] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const initialRequiredDateFromContext = useMemo(() => {
    const fromProject = String(boqProject?.requiredDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromProject)) return fromProject;
    const fromVoice = String(navVoiceCart?.requiredDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromVoice)) return fromVoice;
    return '';
  }, [boqProject?.requiredDate, navVoiceCart?.requiredDate]);
  const [requiredDate, setRequiredDate] = useState(initialRequiredDateFromContext);
  const [creatingOrders, setCreatingOrders] = useState(false);
  /** Vault-only checkout: orders are paid from PM vault (products + transport). */
  const [poPaymentMethod, setPoPaymentMethod] = useState(VAULT_PAYMENT_METHOD);
  /** Payment details collected based on selected method (card number, UTR, etc.) */
  const [paymentDetails, setPaymentDetails] = useState({});
  /** Online flow: show platform test QR before calling create API. */
  const [showOnlineQrModal, setShowOnlineQrModal] = useState(false);
  const [platformQrDataUrl, setPlatformQrDataUrl] = useState('');
  const [serviceProviderGstin, setServiceProviderGstin] = useState('');
  const [shippingAddress, setShippingAddress] = useState(blankAddress);
  const [checkoutShippingProjectName, setCheckoutShippingProjectName] = useState('');
  const [createdTransportOrders, setCreatedTransportOrders] = useState([]);
  const [selectedTransport, setSelectedTransport] = useState(null);
  const [expandedItemSpecs, setExpandedItemSpecs] = useState({});
  const transportReturnHandledRef = useRef(false);
  const [creditChecks, setCreditChecks] = useState([]);
  const [creditCheckLoading, setCreditCheckLoading] = useState(false);
  const [creditCheckFailed, setCreditCheckFailed] = useState(false);
  const [payLaterEligibility, setPayLaterEligibility] = useState([]);
  const [vaultBalance, setVaultBalance] = useState(0);
  const [loadingVaultBalance, setLoadingVaultBalance] = useState(false);
  const [checkoutSessionId, setCheckoutSessionId] = useState('');
  const [reservationExpiresAt, setReservationExpiresAt] = useState('');
  const [reservationSecondsLeft, setReservationSecondsLeft] = useState(0);
  const [reservationExpired, setReservationExpired] = useState(false);
  const [reservingInventory, setReservingInventory] = useState(false);
  const [reservationMinutes, setReservationMinutes] = useState(DEFAULT_CHECKOUT_RESERVATION_MINUTES);
  const [checkoutBootstrapDone, setCheckoutBootstrapDone] = useState(false);
  const reservationSignatureRef = useRef('');
  const reservationHoldRef = useRef(false);
  const checkoutSessionIdRef = useRef('');

  const clearPoCheckoutSession = () => {
    try {
      sessionStorage.removeItem(SP_PO_CHECKOUT_SESSION_KEY);
    } catch (_) {
      // Non-fatal.
    }
  };

  useEffect(() => {
    let cancelled = false;

    const finishBootstrap = () => {
      if (!cancelled) setCheckoutBootstrapDone(true);
    };

    const token = localStorage.getItem('token');

    (async () => {
      let resolvedMinutes = reservationMinutes;

      if (isCheckoutHoldExpired(SP_PO_CHECKOUT_HOLD_EXPIRED_KEY)) {
        if (!cancelled) {
          navigate(SP_CHECKOUT_CART_PATH, {
            replace: true,
            state: buildCheckoutHoldExpiredNavState(resolvedMinutes)
          });
        }
        return;
      }

      if (token) {
        try {
          const config = await fetchPoCheckoutReservationConfig({ token });
          if (!cancelled && Number(config?.expiresInMinutes) > 0) {
            resolvedMinutes = Number(config.expiresInMinutes);
            setReservationMinutes(resolvedMinutes);
          }
        } catch (e) {
          console.error('Failed to load checkout reservation config:', e);
        }
      }

      const savedSessionId = String(sessionStorage.getItem(SP_PO_CHECKOUT_SESSION_KEY) || '').trim();
      if (savedSessionId && token) {
        try {
          const restored = await readActiveCheckoutReservation({
            token,
            checkoutSessionId: savedSessionId,
            fetchStatus: fetchPoCheckoutReservationStatus
          });
          if (!cancelled && restored.active) {
            checkoutSessionIdRef.current = restored.checkoutSessionId;
            setCheckoutSessionId(restored.checkoutSessionId);
            setReservationExpiresAt(restored.expiresAt);
            reservationHoldRef.current = true;
            setReservationSecondsLeft(restored.secondsLeft || 0);
          } else if (!cancelled) {
            clearPoCheckoutSession();
            if (restored.reason === 'expired' || restored.reason === 'inactive') {
              markCheckoutHoldExpired(SP_PO_CHECKOUT_HOLD_EXPIRED_KEY);
              navigate(SP_CHECKOUT_CART_PATH, {
                replace: true,
                state: buildCheckoutHoldExpiredNavState(resolvedMinutes)
              });
              return;
            }
          }
        } catch (e) {
          console.error('Failed to restore PO checkout reservation:', e);
          if (!cancelled) clearPoCheckoutSession();
        }
      }

      finishBootstrap();
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const releasePoCheckoutHold = async () => {
    const sessionId = String(checkoutSessionId || sessionStorage.getItem(SP_PO_CHECKOUT_SESSION_KEY) || '').trim();
    if (!sessionId) return;
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      await releasePoCheckoutInventory({ token, checkoutSessionId: sessionId });
    } catch (e) {
      console.error('Failed to release PO checkout hold:', e);
    } finally {
      clearPoCheckoutSession();
    }
  };

  const redirectToCartAfterHoldExpiry = async (minutes = reservationMinutes) => {
    setReservationExpired(true);
    markCheckoutHoldExpired(SP_PO_CHECKOUT_HOLD_EXPIRED_KEY);
    await releasePoCheckoutHold();
    setPoGroups([]);
    setCheckoutSessionId('');
    setReservationExpiresAt('');
    reservationHoldRef.current = false;
    reservationSignatureRef.current = '';
    navigate(SP_CHECKOUT_CART_PATH, {
      replace: true,
      state: buildCheckoutHoldExpiredNavState(minutes)
    });
  };

  const handleReservationExpired = async () => {
    if (reservationExpired || reservingInventory || !reservationHoldRef.current) return;
    await redirectToCartAfterHoldExpiry();
  };

  const resetCheckoutReservationState = () => {
    clearPoCheckoutSession();
    checkoutSessionIdRef.current = '';
    reservationSignatureRef.current = '';
    reservationHoldRef.current = false;
    setCheckoutSessionId('');
    setReservationExpiresAt('');
    setReservationExpired(false);
    setReservationSecondsLeft(0);
  };

  const grandTotalAllPos = useMemo(
    () => poGroups.reduce((sum, g) => sum + (Number(g.total) || 0), 0),
    [poGroups]
  );
  const transportTotalAllPos = useMemo(() => {
    const st = selectedTransport;
    if (!st || typeof st !== 'object') return 0;
    const parseQuote = (raw) => {
      if (raw === null || raw === undefined || raw === '') return null;
      const n = Number(String(raw).replace(/,/g, ''));
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
    };
    const byVendor = st.byVendorId && typeof st.byVendorId === 'object' ? st.byVendorId : null;
    const details =
      st.byVendorCourierDetail && typeof st.byVendorCourierDetail === 'object'
        ? st.byVendorCourierDetail
        : null;
    if (byVendor && details) {
      let sum = 0;
      for (const key of Object.keys(byVendor)) {
        if (!String(byVendor[key] || '').trim()) continue;
        const det = details[key];
        const quoted = parseQuote(det?.fareValue) ?? parseQuote(det?.rate);
        if (quoted != null) sum += quoted;
      }
      return Math.round(sum * 100) / 100;
    }
    return 0;
  }, [selectedTransport]);
  const checkoutTotalDue = useMemo(
    () => Math.round((Number(grandTotalAllPos || 0) + Number(transportTotalAllPos || 0)) * 100) / 100,
    [grandTotalAllPos, transportTotalAllPos]
  );
  const vaultShortage = useMemo(
    () => Math.max(0, Number(checkoutTotalDue || 0) - Number(vaultBalance || 0)),
    [checkoutTotalDue, vaultBalance]
  );
  const hasSufficientVaultBalance = vaultShortage <= 0;

  const workflowItems = voiceCart?.items?.length ? voiceCart.items : items;
  const workflowVendors =
    voiceCart?.selectedVendors && Object.keys(voiceCart.selectedVendors).length
      ? voiceCart.selectedVendors
      : selectedVendors;
  const workflowSubs = voiceCart?.substitutions ?? substitutions;
  const shippingAddressGroupingKey = useMemo(
    () =>
      ['line1', 'city', 'state', 'pincode', 'country']
        .map((key) => String(shippingAddress?.[key] || '').trim().toLowerCase())
        .join('|'),
    [shippingAddress]
  );

  // Load server PO cart for voice flow, discovery/cart checkout (no BOQ rows in App state), and to refresh after voice navigation.
  useEffect(() => {
    let cancelled = false;
    const hasPropItems = Array.isArray(items) && items.length > 0;
    if (hasPropItems && !voiceGuided) {
      setCartContextReady(true);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      const draft = await fetchVoiceCartDraft();
      if (cancelled) return;
      setVoiceCart((prev) => {
        if (Array.isArray(draft?.items) && draft.items.length > 0) return draft;
        if (prev && Array.isArray(prev.items) && prev.items.length > 0) return prev;
        return draft;
      });
      setCartContextReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [items, voiceGuided, location.state?.voiceNavSeq]);

  useEffect(() => {
    if (!cartContextReady) {
      setLoading(true);
      setError(null);
      return;
    }

    // Validate that we have the required data
    if (!workflowItems || workflowItems.length === 0) {
      setError(
        'No line items in this checkout. Add products from Product Discovery or your cart, or upload a BOQ file to continue.'
      );
      setLoading(false);
      return;
    }

    if (!workflowVendors || Object.keys(workflowVendors).length === 0) {
      setError('No suppliers selected. Please go back and select suppliers for your items.');
      setLoading(false);
      return;
    }

    // Group by supplier + delivery address (re-runs when checkout address finishes loading).
    groupByVendor();
  }, [cartContextReady, workflowVendors, workflowSubs, workflowItems, shippingAddressGroupingKey]);

  useEffect(() => {
    if (!checkoutBootstrapDone || loading || reservationExpired || !poGroups.length) return undefined;

    const lines = buildPoReservationLinesFromGroups(poGroups);
    if (!lines.length) return undefined;

    // Order-independent signature: grouping re-running (e.g. once the delivery address finishes
    // loading async) can produce the same lines in a different order, which would otherwise look
    // like a real cart change and trigger release + re-reserve of an identical hold — handing
    // back a just-released reservation row with a stale, already-past expiry.
    const signature = buildStableReservationLineSignature(lines);
    if (signature === reservationSignatureRef.current && reservationHoldRef.current) {
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setReservingInventory(true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('Please sign in again to reserve inventory for checkout.');

        const sessionId =
          checkoutSessionIdRef.current ||
          String(checkoutSessionId || sessionStorage.getItem(SP_PO_CHECKOUT_SESSION_KEY) || '').trim() ||
          createCheckoutSessionId();
        checkoutSessionIdRef.current = sessionId;
        const data = await reservePoCheckoutInventory({
          token,
          checkoutSessionId: sessionId,
          lines
        });
        if (cancelled) return;

        reservationSignatureRef.current = signature;
        reservationHoldRef.current = true;
        clearCheckoutHoldExpired(SP_PO_CHECKOUT_HOLD_EXPIRED_KEY);
        const activeSessionId = data.checkoutSessionId || sessionId;
        setCheckoutSessionId(activeSessionId);
        setReservationExpiresAt(data.expiresAt || '');
        if (Number(data.expiresInMinutes) > 0) {
          setReservationMinutes(Number(data.expiresInMinutes));
        }
        sessionStorage.setItem(SP_PO_CHECKOUT_SESSION_KEY, activeSessionId);
        setError(null);
      } catch (reserveError) {
        if (!cancelled) {
          reservationHoldRef.current = false;
          setError(reserveError?.message || 'Failed to reserve inventory for checkout.');
          setPoGroups([]);
          resetCheckoutReservationState();
        }
      } finally {
        if (!cancelled) setReservingInventory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [checkoutBootstrapDone, loading, poGroups, reservationExpired]);

  useEffect(() => {
    if (!reservationExpiresAt || reservationExpired || reservingInventory || !reservationHoldRef.current) {
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
  }, [reservationExpiresAt, reservationExpired, reservingInventory]);

  useEffect(() => {
    if (requiredDate) return;
    const fromProject = String(boqProject?.requiredDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromProject)) {
      setRequiredDate(fromProject);
      return;
    }
    const fromVoice = String(voiceCart?.requiredDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromVoice)) {
      setRequiredDate(fromVoice);
    }
  }, [boqProject?.requiredDate, voiceCart?.requiredDate, requiredDate]);

  useEffect(() => {
    if (!cartContextReady) return undefined;

    const token = localStorage.getItem('token');
    if (!token) return undefined;

    let cancelled = false;
    const loadCheckoutAddresses = async () => {
      try {
        const [profileResponse, cartSnapshot] = await Promise.all([
          fetch(getApiUrl('/api/profile'), {
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetchVoiceCartDraft()
        ]);
        if (cancelled) return;

        let profileData = null;
        if (profileResponse.ok) {
          profileData = await profileResponse.json();
          if (profileData?.profile) {
            const gstin = String(profileData.profile.gstin || profileData.profile.mainGstin || '').trim();
            setServiceProviderGstin(gstin);
          }
        }

        const sessionProject = readSupplierSelectBoqProjectSessionIfFresh();
        const workflowShipping = resolveWorkflowShippingAddress({
          boqProject: boqProject || sessionProject,
          cartDraft: cartSnapshot?.draft || voiceCart,
          workflowItems
        });

        if (workflowShipping?.address) {
          setShippingAddress(workflowShipping.address);
          setCheckoutShippingProjectName(workflowShipping.projectName || '');
          return;
        }

        setCheckoutShippingProjectName('');
        const profileShippingList = Array.isArray(profileData?.profile?.shippingAddresses)
          ? profileData.profile.shippingAddresses
          : [];
        if (profileShippingList.length > 0) {
          setShippingAddress(normalizeAddress(profileShippingList[0]));
        }
      } catch (profileError) {
        console.warn('Failed to preload checkout addresses for Create PO:', profileError);
      }
    };

    void loadCheckoutAddresses();
    return () => {
      cancelled = true;
    };
  }, [cartContextReady, boqProject, workflowItems, voiceCart]);

  const toggleItemSpecs = (groupVendorId, item, idx) => {
    const key = `${groupVendorId || 'vendor'}::${item?.supplierProductId || item?.productId || item?.name || idx}`;
    setExpandedItemSpecs((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  useEffect(() => {
    const routeState = location.state || {};
    const incomingOrders = Array.isArray(routeState.createdOrders) ? routeState.createdOrders : [];
    const incomingTransport =
      routeState.transportSelection && typeof routeState.transportSelection === 'object'
        ? routeState.transportSelection
        : null;

    if (incomingOrders.length > 0) {
      setCreatedTransportOrders(incomingOrders);
    }

    if (incomingTransport) {
      transportReturnHandledRef.current = true;
      setSelectedTransport((prev) =>
        normalizeTransportSelection(mergeTransportSelections(prev, incomingTransport))
      );
      navigate(location.pathname, { replace: true, state: null });
      return;
    }

    if (transportReturnHandledRef.current) {
      transportReturnHandledRef.current = false;
      return;
    }

    setSelectedTransport(null);
    void clearCartTransportSelection();
  }, [location.pathname, location.state, navigate]);

  const groupByVendor = async () => {
    setLoading(true);
    setError(null);
    
    // Get auth token
    const token = localStorage.getItem('token');
    
    try {
      const vendors = workflowVendors;
      const subs = workflowSubs;
      const lineItems = workflowItems;

      const res = await fetch(getApiUrl('/api/po/group'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          selectedVendors: vendors,
          substitutions: subs,
          items: await mergeWorkflowItemsWithSavedCart(lineItems, shippingAddress),
          defaultShippingAddress: shippingAddress
        })
      });
      
      // Check if response is ok
      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = 'Failed to group purchase orders';
        try {
          const errorData = JSON.parse(errorText);
          // Backend often puts the real failure on `error` while `message` stays generic for 500s.
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      // Check if response has content
      const text = await res.text();
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from server');
      }
      
      const data = JSON.parse(text);
      console.log('PO groups response:', data);
      
      if (data.groups && Array.isArray(data.groups) && data.groups.length > 0) {
        setPoGroups(data.groups);
        setError(null);
      } else {
        const errorMsg = data.message || 'No purchase order groups were created. Please ensure all items have selected suppliers and matching products.';
        console.error('No groups returned:', data);
        setError(errorMsg);
        setPoGroups([]);
      }
    } catch (error) {
      console.error('Failed to group POs:', error);
      setError(error.message || 'Failed to group purchase orders. Please try again.');
      setPoGroups([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!showOnlineQrModal) {
      setPlatformQrDataUrl('');
      return;
    }
    const payload = buildTestPlatformPaymentPayload(grandTotalAllPos);
    if (!payload) {
      setPlatformQrDataUrl('');
      return undefined;
    }
    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: 260,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' }
    })
      .then((url) => {
        if (!cancelled) setPlatformQrDataUrl(url);
      })
      .catch((e) => {
        console.error('QR generation failed:', e);
      });
    return () => {
      cancelled = true;
    };
  }, [showOnlineQrModal, grandTotalAllPos]);

  useEffect(() => {
    if (!poGroups?.length) {
      setCreditChecks([]);
      setPayLaterEligibility([]);
      setCreditCheckFailed(false);
      return;
    }
    const token = localStorage.getItem('token');
    const checks = poGroups
      .filter((g) => g?.vendorId !== null && g?.vendorId !== undefined)
      .map((g) => ({
        supplierId: g.vendorId,
        orderAmount: Number(g.total) || 0
      }));
    if (!checks.length) {
      setCreditChecks([]);
      setPayLaterEligibility([]);
      setCreditCheckFailed(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setCreditCheckLoading(true);
        setCreditCheckFailed(false);
        const res = await fetch(getApiUrl('/api/po/credit-check'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ checks })
        });
        const data = await res.json();
        if (!cancelled && data.status === 'success') {
          const results = data.results || [];
          setPayLaterEligibility(results);
          setCreditChecks(results);
          setCreditCheckFailed(false);
        } else if (!cancelled) {
          setCreditChecks([]);
          setPayLaterEligibility([]);
          setCreditCheckFailed(true);
        }
      } catch (e) {
        if (!cancelled) {
          setCreditChecks([]);
          setPayLaterEligibility([]);
          setCreditCheckFailed(true);
        }
      } finally {
        if (!cancelled) setCreditCheckLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poGroups]);

  useEffect(() => {
    if (!isVaultPaymentMethod(poPaymentMethod)) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingVaultBalance(true);
        const balance = await getVaultBalanceForUi();
        if (!cancelled) setVaultBalance(balance);
      } catch {
        if (!cancelled) setVaultBalance(0);
      } finally {
        if (!cancelled) setLoadingVaultBalance(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poPaymentMethod, poGroups]);

  const payLaterOptionAvailable = useMemo(() => {
    if (!poGroups?.length) return false;
    if (creditCheckFailed) return false;
    if (!payLaterEligibility.length) return false;
    const bySupplier = new Map(payLaterEligibility.map((r) => [String(r.supplierId), r]));
    return poGroups.every((g) => {
      const row = bySupplier.get(String(g.vendorId));
      return Boolean(row?.allowed && row?.payLaterOffered);
    });
  }, [creditCheckFailed, payLaterEligibility, poGroups]);

  const creditAllAllowed = useMemo(() => {
    if (poPaymentMethod !== 'credit') return true;
    if (creditCheckFailed) return false;
    if (!creditChecks.length) return false;
    return creditChecks.every((r) => r.allowed);
  }, [poPaymentMethod, creditChecks, creditCheckFailed]);

  const createPurchaseOrders = async () => {
    const sessionId =
      String(checkoutSessionId || sessionStorage.getItem(SP_PO_CHECKOUT_SESSION_KEY) || '').trim();
    if (!sessionId) {
      throw new Error('Checkout inventory hold is missing. Return to supplier selection and try again.');
    }
    if (reservationExpired || reservationSecondsLeft <= 0) {
      await redirectToCartAfterHoldExpiry();
      throw new Error('Checkout inventory hold expired');
    }

    console.log('Creating POs with groups:', poGroups, 'Required date:', requiredDate);

    const res = await fetch(getApiUrl('/api/po/create'), {
      method: 'POST',
      headers: buildAuthHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({
        poGroups,
        checkoutSessionId: sessionId,
        boqId,
        requiredDate,
        paymentMethod: poPaymentMethod,
        paymentDetails: Object.keys(paymentDetails).length > 0 ? paymentDetails : undefined,
        deliveryDestination: 'shipping',
        shippingAddress,
        billingAddress: shippingAddress,
        gstin: serviceProviderGstin || null,
        quotedTransportTotal: transportTotalAllPos
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorMessage = 'Failed to create purchase orders';
      let errorData = null;
      try {
        errorData = JSON.parse(errorText);
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }
      if (isInventoryHoldExpiredApiError(errorData || { message: errorMessage })) {
        await redirectToCartAfterHoldExpiry();
        throw new Error('Checkout inventory hold expired');
      }
      throw new Error(errorMessage);
    }

    const text = await res.text();
    if (!text || text.trim().length === 0) {
      throw new Error('Empty response from server');
    }

    const data = JSON.parse(text);
    if (!data.success) {
      throw new Error(data.error || data.message || 'Failed to create purchase orders');
    }
    return data;
  };

  const finalizeTransportDetails = async (ordersToConfirm = createdTransportOrders) => {
    const orderList = Array.isArray(ordersToConfirm) ? ordersToConfirm : [];
    const orderIds = orderList.map((order) => order?.id).filter(Boolean);
    if (orderIds.length === 0) {
      throw new Error('No transport-stage orders found. Please click Transport suggestion first.');
    }
    const st = selectedTransport;
    const hasPerVendor =
      st?.byVendorId && typeof st.byVendorId === 'object' && Object.keys(st.byVendorId).length > 0;

    const parseQuoteInr = (raw) => {
      if (raw === null || raw === undefined || raw === '') return null;
      const n = Number(String(raw).replace(/,/g, ''));
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
    };

    const isTruckingDetail = (det) => {
      if (!det || typeof det !== 'object') return false;
      const mode = String(det.transportMode || det.transport_mode || '').toLowerCase();
      if (mode === 'trucking') return true;
      if (String(det.source || '').toLowerCase() === 'borzo') return true;
      const vt = det.vehicle_type_id ?? det.vehicleTypeId;
      return vt != null && vt !== '' && Number(vt) > 0;
    };
    const isSelfShipDetail = (det, shippingProvider = '') => {
      const mode = String(det?.transportMode || det?.transport_mode || '').toLowerCase();
      const providerName = String(shippingProvider || '').trim().toLowerCase();
      return mode === 'self_ship' || providerName === 'self ship' || providerName === 'self-ship';
    };

    const applyTruckingFields = (target, det) => {
      const vtRaw = det?.vehicle_type_id ?? det?.vehicleTypeId;
      const vtn = vtRaw != null && vtRaw !== '' ? Number(vtRaw) : NaN;
      if (Number.isFinite(vtn) && vtn > 0) target.vehicleTypeId = vtn;
      target.transportMode = 'trucking';
      if (det?.source) target.source = String(det.source);
      if (det?.weightKg != null && Number(det.weightKg) > 0) target.weightKg = Number(det.weightKg);
      if (det?.pickup_lat != null) target.pickupLat = Number(det.pickup_lat);
      if (det?.pickup_lng != null) target.pickupLng = Number(det.pickup_lng);
      if (det?.delivery_lat != null) target.deliveryLat = Number(det.delivery_lat);
      if (det?.delivery_lng != null) target.deliveryLng = Number(det.delivery_lng);
      if (det?.carrier) target.carrier = String(det.carrier);
      if (det?.name) target.matter = String(det.name);
    };

    let confirmBody;
    if (hasPerVendor) {
      const perOrderTransport = orderList.map((o) => {
        const transportKey = String(o.transportGroupId || o.supplierId || '').trim();
        const sp = String(st.byVendorId[transportKey] || st.byVendorId[String(o.supplierId || '')] || '').trim();
        if (!sp) {
          throw new Error(
            `Choose a courier for ${o.supplier || 'each supplier shipment'} on Transport suggestion before confirming.`
          );
        }
        const det =
          st.byVendorCourierDetail && typeof st.byVendorCourierDetail === 'object'
            ? st.byVendorCourierDetail[transportKey] || st.byVendorCourierDetail[String(o.supplierId || '')]
            : null;
        const quotedTransportAmount =
          parseQuoteInr(det?.fareValue) ?? parseQuoteInr(det?.rate);
        const courierCompanyId =
          det?.courier_company_id != null && det?.courier_company_id !== ''
            ? Number(det.courier_company_id)
            : null;
        const row = {
          orderId: o.id,
          shippingProvider: sp,
          trackingNumber: st.trackingNumber || null,
          trackingUrl: st.trackingUrl || null,
          transportNotes: st.transportNotes || null,
          ...(quotedTransportAmount != null ? { quotedTransportAmount } : {})
        };
        if (isSelfShipDetail(det, sp)) {
          row.transportMode = 'self_ship';
          row.source = 'self_ship';
        } else if (isTruckingDetail(det)) {
          applyTruckingFields(row, det);
        } else {
          row.transportMode = 'courier';
          if (Number.isFinite(courierCompanyId) && courierCompanyId > 0) {
            row.courierCompanyId = courierCompanyId;
          }
          const td = det?.transit_days ?? det?.transitDays;
          if (td != null && td !== '') row.transitDays = Number(td);
          if (det?.transportGroupId) row.transportGroupId = String(det.transportGroupId);
          if (det?.pickupPincode) row.pickupPincode = String(det.pickupPincode).replace(/\D/g, '').slice(0, 6);
          if (det?.etd) row.etd = String(det.etd);
        }
        return row;
      });
      confirmBody = { orderIds, perOrderTransport };
    } else {
      if (!String(st?.shippingProvider || '').trim()) {
        throw new Error('Please select transport details first.');
      }
      confirmBody = {
        orderIds,
        shippingProvider: st.shippingProvider,
        trackingNumber: st.trackingNumber || null,
        trackingUrl: st.trackingUrl || null,
        transportNotes: st.transportNotes || null
      };
      if (orderList.length === 1 && st.byVendorCourierDetail && typeof st.byVendorCourierDetail === 'object') {
        const sid = String(orderList[0].supplierId || '');
        const det = st.byVendorCourierDetail[sid];
        const q = parseQuoteInr(det?.fareValue) ?? parseQuoteInr(det?.rate);
        if (q != null) {
          confirmBody.quotedTransportAmount = q;
        }
        const cc = det?.courier_company_id;
        const n = cc != null && cc !== '' ? Number(cc) : NaN;
        if (isSelfShipDetail(det, st.shippingProvider)) {
          confirmBody.transportMode = 'self_ship';
          confirmBody.source = 'self_ship';
        } else if (isTruckingDetail(det)) {
          applyTruckingFields(confirmBody, det);
        } else {
          confirmBody.transportMode = 'courier';
          if (Number.isFinite(n) && n > 0) {
            confirmBody.courierCompanyId = n;
          }
          const td = det?.transit_days ?? det?.transitDays;
          if (td != null && td !== '') confirmBody.transitDays = Number(td);
          if (det?.transportGroupId) confirmBody.transportGroupId = String(det.transportGroupId);
          if (det?.pickupPincode) {
            confirmBody.pickupPincode = String(det.pickupPincode).replace(/\D/g, '').slice(0, 6);
          }
          if (det?.etd) confirmBody.etd = String(det.etd);
        }
      }
    }

    const res = await fetch(getApiUrl('/api/po/transport/confirm'), {
      method: 'POST',
      headers: buildAuthHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(confirmBody)
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorMessage = 'Failed to update transport details';
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.message || errorData.error || errorMessage;
        if (/^not found$/i.test(String(errorMessage).trim())) {
          errorMessage =
            'Transport confirmation failed (carrier booking endpoint not found on the logistics service). Check server LOGISTICS_MODULE_URL / LOGISTICS_BOOK_COURIER_CHECKOUT_URL, then retry.';
        }
      } catch (e) {
        const raw = String(errorText || '').trim();
        errorMessage =
          !raw || /^not found$/i.test(raw)
            ? `Transport confirmation failed (HTTP ${res.status}). Please retry or contact support.`
            : raw;
      }
      throw new Error(errorMessage);
    }
    return res.json();
  };

  const completeOrderFlow = async () => {
    try {
      setCreatingOrders(true);
      let activeOrders = Array.isArray(createdTransportOrders) ? createdTransportOrders : [];
      if (activeOrders.length === 0) {
        const data = await createPurchaseOrders();
        activeOrders = Array.isArray(data.orders) ? data.orders : [];
        setCreatedTransportOrders(activeOrders);
      }
      const transportResult = await finalizeTransportDetails(activeOrders);

      if (isVaultPaymentMethod(poPaymentMethod)) {
        const unpaid = activeOrders.filter((order) => order?.id);
        for (const order of unpaid) {
          const payData = await payOrderFromVault(order.id, {
            idempotencyKey: `create-po-vault-${order.id}`
          });
          if (payData?.status && payData.status !== 'success') {
            throw new Error(
              payData.message ||
                `Failed to debit vault for order ${order.orderNumber || order.id}. Products + transport were not fully paid.`
            );
          }
        }
      }

      await clearCartTransportSelection();
      setSelectedTransport(null);
      reservationSignatureRef.current = '';
      reservationHoldRef.current = false;
      clearPoCheckoutSession();
      setCheckoutSessionId('');
      setReservationExpiresAt('');
      setConfirmed(true);
      const warnings = Array.isArray(transportResult?.warnings) ? transportResult.warnings : [];
      if (warnings.length > 0) {
        alert(
          transportResult?.message ||
            `POs created. Carrier booking is pending for ${warnings.length} shipment(s); tracking can be updated later.`
        );
      }
    } catch (err) {
      console.error('Failed to finalize transport flow:', err);
      alert(err.message || 'Failed to finalize purchase orders. Please try again.');
    } finally {
      setCreatingOrders(false);
    }
  };

  const handleConfirm = async () => {
    if (creatingOrders) return;

    if (!poGroups || poGroups.length === 0) {
      alert('No purchase order groups available. Please ensure all items have selected suppliers.');
      await groupByVendor();
      return;
    }

    if (!requiredDate) {
      const proceed = window.confirm(
        'You have not specified a "Required by" date.\n\nDo you want to continue without a required date?'
      );
      if (!proceed) {
        return;
      }
    } else if (isDateBeforeToday(requiredDate)) {
      alert('Required by date cannot be in the past.');
      return;
    }

    const missingShipping = ['line1', 'city', 'state', 'pincode', 'country'].find(
      (key) => !String(shippingAddress?.[key] || '').trim()
    );
    if (missingShipping) {
      alert('Delivery address is missing. Go back to your cart and set a shipping address before creating purchase orders.');
      return;
    }

    if (poPaymentMethod === 'credit') {
      if (creditCheckLoading || creditCheckFailed) {
        alert(PAY_LATER_LIMIT_CHECK_FAILED_MESSAGE);
        return;
      }
      if (!payLaterOptionAvailable || !creditAllAllowed) {
        alert(PAY_LATER_UNAVAILABLE_MESSAGE);
        return;
      }
    }
    if (isVaultPaymentMethod(poPaymentMethod)) {
      if (loadingVaultBalance) {
        alert('Checking vault balance. Please wait and try again.');
        return;
      }
      if (!hasSufficientVaultBalance) {
        alert(
          `Insufficient vault balance. You need ₹${vaultShortage.toLocaleString(
            'en-IN'
          )} more. Please credit vault first.`
        );
        return;
      }
    }

    if (reservingInventory) {
      alert('Refreshing inventory hold. Please wait a moment.');
      return;
    }
    if (!reservationHoldRef.current || !checkoutSessionId || reservationExpired || reservationSecondsLeft <= 0) {
      await redirectToCartAfterHoldExpiry();
      return;
    }

    await completeOrderFlow();
  };

  const handlePlaceOrderAfterPlatformQr = async () => {
    setShowOnlineQrModal(false);
    await completeOrderFlow();
  };

  const handleTransportSuggestion = async (group) => {
    if (creatingOrders) return;
    if (!poGroups || poGroups.length === 0) {
      alert('No purchase order groups available. Please ensure all items have selected suppliers.');
      return;
    }
    const scopedGroups = group ? [group] : poGroups;
    const focusTransportGroupId = group ? getTransportGroupKey(group) : '';

    const baseTransport = normalizeTransportSelection(selectedTransport);

    const missingShipping = ['line1', 'city', 'state', 'pincode', 'country'].find(
      (key) => !String(shippingAddress?.[key] || '').trim()
    );
    if (missingShipping) {
      alert('Delivery address is missing. Go back to your cart and set a shipping address before transport suggestions.');
      return;
    }

    const logisticsUi = String(import.meta.env.VITE_LOGISTICS_UI_BASE_URL || '').trim();
    if (logisticsUi) {
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(resolveApiPath('/api/logistics/bridge-session'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            poGroups: scopedGroups,
            shippingAddress,
            billingAddress: shippingAddress,
            deliveryDestination: 'shipping',
            hasGstin: false
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.message || data.error || 'Could not prepare logistics session.');
          return;
        }
        const sessionId = data.sessionId;
        if (!sessionId) {
          alert('Invalid response from logistics bridge.');
          return;
        }
        const base = logisticsUi.replace(/\/$/, '');
        const commerceApi = encodeURIComponent(API_BASE_URL.replace(/\/$/, ''));
        window.location.assign(
          `${base}/service-provider?session=${encodeURIComponent(sessionId)}&commerceApi=${commerceApi}`
        );
      } catch (e) {
        console.error(e);
        alert(e?.message || 'Network error while opening logistics.');
      }
      return;
    }

    navigate('/transport-suggestion', {
      state: {
        poGroups: scopedGroups,
        allPoGroups: poGroups,
        focusTransportGroupId,
        focusVendorId: focusTransportGroupId,
        existingTransportSelection: baseTransport,
        grandTotalAllPos: group ? Number(group.total) || 0 : grandTotalAllPos,
        requiredDate,
        hasGstin: false,
        deliveryDestination: 'shipping',
        shippingAddress,
        billingAddress: shippingAddress,
        createdOrders: createdTransportOrders
      }
    });
  };

  if (confirmed) {
    return (
      <div className="page">
        <div className="success-state">
          <Check size={64} className="success-icon" />
          <h2>Purchase Orders Created!</h2>
          <p>All POs have been successfully generated and sent to vendors.</p>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" className="btn-primary" onClick={() => navigate('/your-orders')}>
              View your orders
            </button>
            <button type="button" className="btn-secondary" onClick={() => navigate('/dashboard')}>
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading || reservingInventory) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Create Purchase Orders</h1>
          <p>
            {loading
              ? cartContextReady
                ? 'Grouping items by vendor…'
                : 'Loading your cart and checkout…'
              : 'Holding supplier inventory for your checkout…'}
          </p>
        </div>
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p>
            {loading
              ? cartContextReady
                ? 'Please wait while we group your purchase orders…'
                : 'Syncing your saved cart (voice or discovery) before creating purchase orders…'
              : `Reserving stock for ${reservationMinutes} minutes while checkout loads…`}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    const errorMessage = typeof error === 'string' ? error : String(error?.message || error);
    const isReservationError = /inventory hold has expired/i.test(errorMessage);
    if (isReservationError) {
      void redirectToCartAfterHoldExpiry();
      return null;
    }
    return (
      <div className="page">
        <div className="page-header">
          <h1>Create Purchase Orders</h1>
          <p>{isReservationError ? 'Checkout inventory hold ended' : 'Error grouping purchase orders'}</p>
        </div>
        <div style={{
          background: '#fee2e2',
          border: '1px solid #fca5a5',
          borderRadius: '8px',
          padding: '1.5rem',
          margin: '2rem 0',
          color: '#991b1b'
        }}>
          <h3 style={{ marginTop: 0, color: '#991b1b' }}>Error</h3>
          <p>{errorMessage}</p>
          <button
            className="btn-primary"
            onClick={() => {
              resetCheckoutReservationState();
              setError(null);
              navigate(SP_CHECKOUT_CART_PATH, { replace: true });
            }}
            style={{ marginTop: '1rem' }}
          >
            Back to cart
          </button>
        </div>
      </div>
    );
  }

  return (
    <SpWorkflowPage title="Create Purchase Orders" description="Review and confirm POs grouped by vendor" icon={Package}>
    <div className="page !p-0">
      <VoiceGuidedBanner />

      {(checkoutSessionId && reservationExpiresAt && !reservationExpired && reservationSecondsLeft > 0) ||
      reservingInventory ? (
        <div
          className={`po-reservation-banner ${
            reservationSecondsLeft > 0 && reservationSecondsLeft <= 120 ? 'po-reservation-banner--warning' : ''
          }`}
        >
          <div>
            <strong>Inventory held for checkout</strong>
            <p>
              Supplier stock is reserved for {reservationMinutes} minutes while you complete this order.
              {reservingInventory ? ' Refreshing hold for your latest cart…' : ''}
            </p>
          </div>
          <div className="po-reservation-timer" aria-live="polite">
            {reservingInventory || !reservationExpiresAt
              ? '…'
              : formatReservationCountdown(reservationSecondsLeft)}
          </div>
        </div>
      ) : null}

      <div style={{
        marginBottom: '1.5rem', 
        padding: '1rem', 
        borderRadius: '8px', 
        border: '1px solid #e5e7eb',
        background: '#f9fafb',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        alignItems: 'center'
      }}>
        <div style={{ minWidth: '220px' }}>
          <label style={{ 
            display: 'block', 
            fontSize: '0.875rem', 
            fontWeight: 600, 
            color: '#374151',
            marginBottom: '0.25rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Required By Date
          </label>
          <input
            type="date"
            min={todayDateMin}
            value={requiredDate}
            onChange={(e) => {
              const next = e.target.value;
              if (next && isDateBeforeToday(next)) return;
              setRequiredDate(next);
            }}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '0.9rem'
            }}
          />
        </div>
        <div style={{ width: '100%', flexBasis: '100%', marginTop: '0.5rem' }}>
          <label style={{ 
            display: 'block', 
            fontSize: '0.875rem', 
            fontWeight: 600, 
            color: '#374151',
            marginBottom: '0.35rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Payment method
          </label>
          <select
            value={poPaymentMethod}
            onChange={(e) => {
              setPoPaymentMethod(e.target.value);
              setPaymentDetails((prev) => {
                if (e.target.value === 'credit') return prev;
                return {};
              });
            }}
            style={{
              maxWidth: '320px',
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '0.9rem',
              background: '#fff',
              color: '#334155'
            }}
          >
            <option value={VAULT_PAYMENT_METHOD}>Vault balance only (platform escrow model)</option>
            <option value="credit" disabled={creditCheckLoading || !payLaterOptionAvailable}>
              Pay later (credit account)
            </option>
          </select>
          {isVaultPaymentMethod(poPaymentMethod) ? (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#475569', maxWidth: '640px' }}>
              On confirm, vault is debited for product total plus selected transport charges. Platform escrow then settles supplier payout.
            </p>
          ) : poPaymentMethod === 'credit' ? (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#475569', maxWidth: '640px' }}>
              Pay later uses the credit limit and settlement period configured by each supplier. You cannot change credit terms here.
            </p>
          ) : null}
          <div
            style={{
              marginTop: '0.65rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexWrap: 'wrap'
            }}
          >
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate(VAULT_PAGE_PATH)}
              style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem' }}
            >
              Credit vault
            </button>
            <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
              {isVaultPaymentMethod(poPaymentMethod)
                ? 'Tip: Keep enough vault balance for products + transport before confirming.'
                : 'Tip: Configure credit limit with supplier to use pay later without failures.'}
            </span>
          </div>

          {isVaultPaymentMethod(poPaymentMethod) && (
            <div
              style={{
                marginTop: '0.75rem',
                padding: '0.75rem',
                background: hasSufficientVaultBalance ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${hasSufficientVaultBalance ? '#86efac' : '#fecaca'}`,
                borderRadius: '8px',
                maxWidth: '520px'
              }}
            >
              <p style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
                Vault balance check
              </p>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#475569' }}>
                Products: <strong>₹{Number(grandTotalAllPos || 0).toLocaleString('en-IN')}</strong>
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#475569' }}>
                Transport: <strong>₹{Number(transportTotalAllPos || 0).toLocaleString('en-IN')}</strong>
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#475569' }}>
                Amount to debit:{' '}
                <strong>₹{Number(checkoutTotalDue || 0).toLocaleString('en-IN')}</strong>
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#475569' }}>
                Vault balance:{' '}
                <strong>
                  {loadingVaultBalance
                    ? 'Checking...'
                    : `₹${Number(vaultBalance || 0).toLocaleString('en-IN')}`}
                </strong>
              </p>
              {!loadingVaultBalance && !hasSufficientVaultBalance ? (
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#b91c1c' }}>
                  Additional credit required: <strong>₹{vaultShortage.toLocaleString('en-IN')}</strong>
                </p>
              ) : null}
            </div>
          )}

          {poPaymentMethod === 'credit' && creditCheckFailed && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: '#dc2626', maxWidth: '640px' }}>
              {PAY_LATER_LIMIT_CHECK_FAILED_MESSAGE}
            </p>
          )}

          {poPaymentMethod === 'credit' && !creditCheckFailed && !payLaterOptionAvailable && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: '#dc2626', maxWidth: '640px' }}>
              {PAY_LATER_UNAVAILABLE_MESSAGE}
            </p>
          )}

          {poPaymentMethod === 'card' && (
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', maxWidth: '420px' }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>Card Payment Details</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Card holder name *"
                  value={paymentDetails.cardHolderName || ''}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, cardHolderName: e.target.value }))}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                />
                <select
                  value={paymentDetails.cardNetwork || ''}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, cardNetwork: e.target.value }))}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem', background: '#fff' }}
                >
                  <option value="">Select card type *</option>
                  <option value="visa">Visa</option>
                  <option value="mastercard">Mastercard</option>
                  <option value="rupay">RuPay</option>
                  <option value="amex">American Express</option>
                  <option value="other">Other</option>
                </select>
                <input
                  type="text"
                  placeholder="Last 4 digits of card *"
                  maxLength={4}
                  value={paymentDetails.last4Digits || ''}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, last4Digits: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                />
                <input
                  type="text"
                  placeholder="Transaction / Approval code *"
                  value={paymentDetails.transactionId || ''}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, transactionId: e.target.value }))}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                />
                <input
                  type="date"
                  value={paymentDetails.paymentDate || ''}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, paymentDate: e.target.value }))}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                  title="Date of transaction"
                />
              </div>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', color: '#6b7280' }}>* Required fields for reconciliation</p>
            </div>
          )}

          {poPaymentMethod === 'bank_transfer' && (
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', maxWidth: '420px' }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>Bank Transfer Details</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="UTR / Reference number *"
                  value={paymentDetails.utrNumber || ''}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, utrNumber: e.target.value }))}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                />
                <input
                  type="text"
                  placeholder="Account holder name *"
                  value={paymentDetails.accountHolderName || ''}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, accountHolderName: e.target.value }))}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                />
                <input
                  type="text"
                  placeholder="Bank name *"
                  value={paymentDetails.bankName || ''}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, bankName: e.target.value }))}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                />
                <input
                  type="text"
                  placeholder="IFSC code"
                  value={paymentDetails.ifscCode || ''}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, ifscCode: e.target.value.toUpperCase() }))}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                />
                <input
                  type="date"
                  value={paymentDetails.transferDate || ''}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, transferDate: e.target.value }))}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                  title="Date of transfer"
                />
              </div>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', color: '#6b7280' }}>* Required fields. IFSC and date help with faster reconciliation.</p>
            </div>
          )}

          {poPaymentMethod === 'credit' && creditChecks.length > 0 && (
            <div
              style={{
                marginTop: '0.75rem',
                padding: '0.75rem',
                background: creditAllAllowed ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${creditAllAllowed ? '#86efac' : '#fecaca'}`,
                borderRadius: '8px',
                maxWidth: '520px'
              }}
            >
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
                Supplier credit limits {creditCheckLoading ? '(checking…)' : ''}
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem', color: '#475569' }}>
                {creditChecks.map((row) => {
                  const vendor = poGroups.find((g) => String(g.vendorId) === String(row.supplierId));
                  const orderTotal = Number(vendor?.total) || 0;
                  const prior = Number(row.priorNetRevenue ?? row.priorSalesTotal ?? 0);
                  const min = Number(row.payLaterThreshold || 0);
                  return (
                    <li key={row.supplierId} style={{ marginBottom: '0.35rem' }}>
                      <strong>{vendor?.vendorName || 'Supplier'}:</strong>{' '}
                      {row.allowed
                        ? min > 0
                          ? `Pay later OK — limit ₹${Number(row.creditLimit || 0).toLocaleString('en-IN')}, ₹${Number(row.outstanding || 0).toLocaleString('en-IN')} outstanding, up to ₹${Number(row.available ?? row.remainingCredit ?? 0).toLocaleString('en-IN')} for this order. Settlement period: ${Number(row.creditPeriodDays || 30)} days (set by supplier).`
                          : `Pay later OK — limit ₹${Number(row.creditLimit || 0).toLocaleString('en-IN')}, up to ₹${Number(row.available ?? row.remainingCredit ?? 0).toLocaleString('en-IN')} for this order. Settlement period: ${Number(row.creditPeriodDays || 30)} days (set by supplier).`
                        : row.message}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

        </div>
        <div className="checkout-address-card">
          <div className="checkout-address-card__head">
            <h3>Shipping Address</h3>
            <p>Delivery address selected during checkout. To change it, go back to your cart.</p>
          </div>
          {checkoutShippingProjectName ? (
            <p className="checkout-address-note" style={{ marginBottom: '0.75rem' }}>
              Project: <strong>{checkoutShippingProjectName}</strong>
            </p>
          ) : null}
          <p className="checkout-address-preview checkout-address-preview--locked">
            {formatShippingAddressPreview(shippingAddress) || 'No delivery address found. Go back to cart and set a shipping address.'}
          </p>
        </div>
      </div>

      {poGroups.length === 0 ? (
        <div style={{ 
          background: '#fef3c7', 
          border: '1px solid #fcd34d', 
          borderRadius: '8px', 
          padding: '1.5rem', 
          margin: '2rem 0',
          color: '#92400e'
        }}>
          <h3 style={{ marginTop: 0, color: '#92400e' }}>No Purchase Orders to Create</h3>
          <p>No purchase order groups were created. This might happen if:</p>
          <ul style={{ marginLeft: '1.5rem' }}>
            <li>No suppliers were selected for the items</li>
            <li>The selected suppliers don't have matching products in the database</li>
            <li>There was an error processing the items</li>
          </ul>
          <button 
            className="btn-primary" 
            onClick={groupByVendor}
            style={{ marginTop: '1rem' }}
          >
            Retry Grouping
          </button>
        </div>
      ) : (
        <>
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
                  <div className="po-total">₹{group.total?.toLocaleString() || '0'}</div>
                </div>
                <table className="po-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Quantity</th>
                      <th>Unit Price</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items?.map((item, idx) => (
                      <tr key={idx}>
                        <td>
                          {(item.productImage || (Array.isArray(item.images) && item.images[0])) && (
                            <div style={{ marginBottom: '0.35rem' }}>
                              <ProductImageCarousel
                                images={[item.productImage, ...(Array.isArray(item.images) ? item.images : [])]}
                                alt={item.name || 'Product'}
                                height={80}
                                rounded={6}
                              />
                            </div>
                          )}
                          <div>{item.name}</div>
                          {item.productIdentification && (
                            <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '0.2rem' }}>
                              ID: {item.productIdentification}
                            </div>
                          )}
                          <SupplierTsinLine asin={item.asin} variantAsin={item.variantAsin} />
                          {normalizeSpecifications(item.specifications).length > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '0.35rem',
                                marginTop: '0.4rem'
                              }}
                            >
                              {(expandedItemSpecs[`${group.vendorId || 'vendor'}::${item?.supplierProductId || item?.productId || item?.name || idx}`]
                                ? normalizeSpecifications(item.specifications)
                                : normalizeSpecifications(item.specifications).slice(0, 8)).map(([key, value]) => (
                                <span
                                  key={`${item.supplierProductId || item.productId || item.name}-${key}`}
                                  style={{
                                    fontSize: '0.74rem',
                                    color: '#334155',
                                    background: '#f1f5f9',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '9999px',
                                    padding: '0.15rem 0.5rem',
                                    lineHeight: 1.35
                                  }}
                                >
                                  <strong>{key}:</strong> {value}
                                </span>
                              ))}
                              {normalizeSpecifications(item.specifications).length > 8 && (
                                <button
                                  type="button"
                                  onClick={() => toggleItemSpecs(group.vendorId, item, idx)}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: '#2563eb',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    padding: '0.1rem 0.15rem'
                                  }}
                                >
                                  {expandedItemSpecs[`${group.vendorId || 'vendor'}::${item?.supplierProductId || item?.productId || item?.name || idx}`]
                                    ? 'Show less'
                                    : `View all specs (+${normalizeSpecifications(item.specifications).length - 8})`}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td>{item.quantity} {item.unit || ''}</td>
                        <td>₹{item.price?.toLocaleString() || '0'}</td>
                        <td>₹{((item.quantity || 0) * (item.price || 0)).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="po-transport-actions">
                  {isTransportSelectionReadyForVendor(selectedTransport, group) ? (
                    <div className="po-transport-status">
                      <span className="po-transport-status__label">Transport selected</span>
                      {(() => {
                        const transportKey = getTransportGroupKey(group);
                        const d = getVendorTransportDetail(selectedTransport, group);
                        const priceLabel = formatQuoteMoney(d?.rate);
                        const modeLabel =
                          d?.transport_mode === 'self_ship' || d?.transportMode === 'self_ship'
                            ? 'Self ship'
                            : d?.transport_mode === 'trucking' || d?.transportMode === 'trucking'
                              ? 'Trucking'
                              : 'Courier';
                        const carrierName = d?.name || selectedTransport?.byVendorId?.[transportKey];
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
                    disabled={creatingOrders}
                  >
                    {creatingOrders ? 'Saving POs...' : 'Transport suggestion'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {isTransportSelectionReady(selectedTransport, poGroups) ? (
            <div className="po-transport-summary">
              <div className="po-transport-summary__title">
                Selected transport (review rates, then confirm below)
              </div>
              {selectedTransport?.byVendorId && Object.keys(selectedTransport.byVendorId).length > 0 ? (
                <>
                  <div className="po-transport-summary__grid">
                    {Object.entries(selectedTransport.byVendorId)
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
                        const priceLabel = formatQuoteMoney(d?.rate);
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
                            {d?.etd || d?.source || d?.rating != null || d?.cod != null || d?.weightKg != null ? (
                              <div className="po-transport-summary-item__meta">
                                {d?.etd ? (
                                  <span>
                                    ETD: {d.etd}
                                    {d?.source ? ' · ' : ''}
                                  </span>
                                ) : null}
                                {d?.source ? <span>Source: {d.source}</span> : null}
                                {d?.rating != null && d?.rating !== '' ? (
                                  <span> · Rating: {d.rating}</span>
                                ) : null}
                                {d?.cod != null ? <span> · COD: {String(d.cod)}</span> : null}
                                {d?.weightKg != null ? (
                                  <span> · Billable weight: {d.weightKg} kg</span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                  {(() => {
                    const det = selectedTransport.byVendorCourierDetail;
                    if (!det || typeof det !== 'object') return null;
                    let sum = 0;
                    let any = false;
                    for (const vid of Object.keys(selectedTransport.byVendorId || {})) {
                      const r = det[vid]?.fareValue ?? det[vid]?.rate;
                      const n = Number(String(r ?? '').replace(/,/g, ''));
                      if (Number.isFinite(n)) {
                        sum += n;
                        any = true;
                      }
                    }
                    if (!any) return null;
                    return (
                      <div className="po-transport-summary__total">
                        Combined quoted courier charges:{' '}
                        <span className="po-transport-summary__total-amount">{formatQuoteMoney(sum)}</span>
                        <span className="po-transport-summary__total-note">
                          (sum of per-shipment quotes; final billing per carrier)
                        </span>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="po-transport-summary-item__detail">
                  <span className="po-transport-status__mode">Courier:</span>
                  <span className="po-transport-status__name">{selectedTransport.shippingProvider}</span>
                  {selectedTransport.trackingNumber ? (
                    <span className="po-transport-summary-item__meta">
                      Tracking: {selectedTransport.trackingNumber}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              className="btn-primary btn-large"
              onClick={handleConfirm}
              disabled={
                poGroups.length === 0 ||
                creatingOrders ||
                reservingInventory ||
                !checkoutSessionId ||
                reservationExpired ||
                reservationSecondsLeft <= 0 ||
                !isTransportSelectionReady(selectedTransport, poGroups) ||
                (isVaultPaymentMethod(poPaymentMethod) &&
                  (loadingVaultBalance || !hasSufficientVaultBalance))
              }
            >
              {creatingOrders ? 'Finalizing...' : 'Confirm & Create All POs'}
            </button>
          </div>
        </>
      )}

      {showOnlineQrModal ? createPortal((
        <div
          className="modal-overlay"
          onClick={() => !creatingOrders && setShowOnlineQrModal(false)}
        >
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="platform-qr-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="platform-qr-title">Platform payment (test QR)</h2>
              <button
                type="button"
                className="btn-icon"
                onClick={() => !creatingOrders && setShowOnlineQrModal(false)}
                aria-label="Close"
              >
                <X size={22} color="#64748b" />
              </button>
            </div>
            <div className="modal-body">
            <div
              style={{
                textAlign: 'center',
                padding: '1rem',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                marginBottom: '1rem'
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>
                Order total (all POs)
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#4f46e5', marginBottom: '1rem' }}>
                ₹{grandTotalAllPos.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              {platformQrDataUrl ? (
                <img src={platformQrDataUrl} alt="Platform payment QR" style={{ width: 260, height: 260, maxWidth: '100%', borderRadius: 8 }} />
              ) : (
                <div style={{ padding: '3rem', color: '#94a3b8' }}>Generating QR…</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowOnlineQrModal(false)} disabled={creatingOrders}>
                Back
              </button>
              <button type="button" className="btn-primary" onClick={handlePlaceOrderAfterPlatformQr} disabled={creatingOrders} style={{ flex: 1, minWidth: '200px' }}>
                {creatingOrders ? 'Placing order…' : 'Place order'}
              </button>
            </div>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </div>
    </SpWorkflowPage>
  );
};

export default CreatePO;
