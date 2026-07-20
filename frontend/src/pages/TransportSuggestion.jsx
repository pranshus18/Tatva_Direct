import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import VoiceGuidedBanner from '../components/VoiceGuidedBanner';
import SpWorkflowPage from '../components/sp/SpWorkflowPage';
import { Truck } from 'lucide-react';
import { useVoiceSessionContext } from '../voice/VoiceSessionContext';
import { isVoiceGuidedActive } from '../voice/voiceCartBridge';
import { mergeTransportSelections, getVendorTransportDetail, getTransportGroupKey } from '../utils/poTransportSelection';
import { saveCartTransportSelection } from '../utils/poCartTransportApi';
import {
  buildTransportQuoteCacheKey,
  fetchTransportQuotes
} from '../utils/logisticsQuoteApi';

const SELF_SHIP_PROVIDER_NAME = 'Self ship';

const formatCurrency = (value) =>
  `₹${(Number(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const normalizeSpecifications = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const seen = new Set();
  return Object.entries(value).reduce((acc, [key, rawValue]) => {
    const cleanKey = String(key || '').trim();
    const cleanValue = rawValue === null || rawValue === undefined ? '' : String(rawValue).trim();
    if (!cleanKey || !cleanValue) return acc;
    const dedupeKey = cleanKey.toLowerCase();
    if (seen.has(dedupeKey)) return acc;
    seen.add(dedupeKey);
    acc.push([cleanKey, cleanValue]);
    return acc;
  }, []);
};

const isCompleteAddress = (addr) =>
  ['line1', 'city', 'state', 'pincode', 'country'].every((k) => String(addr?.[k] || '').trim());

/** Human-readable lines from API / form address objects (not a summary string). */
const formatAddressLines = (addr) => {
  if (!addr || typeof addr !== 'object') return [];
  const l1 = String(addr.line1 || '').trim();
  const tail = [addr.city, addr.state].filter(Boolean).join(', ');
  const pinCountry = [addr.pincode, addr.country].filter(Boolean).join(' ');
  const lines = [];
  if (l1) lines.push(l1);
  const line2 = [tail, pinCountry].filter(Boolean).join(' · ');
  if (line2) lines.push(line2);
  return lines;
};

function providerSelectionKey(provider) {
  if (provider?.courier_company_id != null && provider.courier_company_id !== '') {
    return `c:${provider.courier_company_id}`;
  }
  if (provider?.vehicle_type_id != null && provider.vehicle_type_id !== '') {
    return `t:${provider.vehicle_type_id}`;
  }
  return `n:${String(provider?.name || '').trim()}`;
}

function providerFareInr(provider) {
  const raw = provider?.fare_value ?? provider?.estimated_fare ?? provider?.rate ?? null;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function TransportPickCard({ provider, selected, onPick, disabled = false, disabledReason = '' }) {
  const [hover, setHover] = React.useState(false);
  const name = String(provider.name || '').trim() || 'Provider';
  const isSelfShip = String(provider.transportKind || '').toLowerCase() === 'self_ship';
  const isTrucking =
    !isSelfShip &&
    (provider.transportKind === 'trucking' ||
    String(provider.source || '').toLowerCase() === 'borzo' ||
    provider.vehicle_type_id != null);
  const badge = isSelfShip ? 'Self ship' : isTrucking ? 'Trucking' : 'Courier';
  const fare = providerFareInr(provider);
  const overCapacity = Boolean(provider.capacity_exceeded);

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={disabled ? disabledReason || 'Unavailable' : `Select ${name}`}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={disabled ? undefined : onPick}
      style={{
        textAlign: 'left',
        width: '100%',
        border: selected ? '2px solid #4f46e5' : `1px solid ${hover ? '#94a3b8' : '#e2e8f0'}`,
        borderRadius: 10,
        padding: '0.7rem 0.85rem',
        background: disabled ? '#f1f5f9' : selected ? '#eef2ff' : hover ? '#f8fafc' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.65 : 1,
        display: 'grid',
        gap: '0.25rem',
        boxShadow: selected
          ? '0 0 0 3px rgba(79, 70, 229, 0.18)'
          : hover
            ? '0 2px 8px rgba(15, 23, 42, 0.08)'
            : 'none',
        transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease',
        transform: hover && !selected ? 'translateY(-1px)' : 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span style={{ fontWeight: 700, color: '#0f172a' }}>{name}</span>
        <span style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              color: isSelfShip ? '#166534' : isTrucking ? '#9a3412' : '#1e40af',
              background: isSelfShip ? '#dcfce7' : isTrucking ? '#ffedd5' : '#dbeafe',
              borderRadius: 9999,
              padding: '0.12rem 0.45rem'
            }}
          >
            {badge}
          </span>
          {selected ? (
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#4338ca',
                background: '#e0e7ff',
                borderRadius: 9999,
                padding: '0.15rem 0.5rem'
              }}
            >
              Selected
            </span>
          ) : null}
        </span>
      </div>
      <div style={{ fontSize: '0.8rem', color: '#475569' }}>
        {isSelfShip ? <span>No external transport booking required</span> : null}
        {provider.carrier ? <span>{provider.carrier} · </span> : null}
        {provider.source ? <span>Source: {provider.source} · </span> : null}
        {fare != null && !isSelfShip ? (
          <span>
            {isTrucking ? 'Fare' : 'Rate'}: {formatCurrency(fare)} ·{' '}
          </span>
        ) : null}
        {overCapacity ? <span style={{ color: '#b45309' }}>Over capacity — split shipment · </span> : null}
        {provider.capacity_kg != null ? <span>Capacity: {provider.capacity_kg} kg · </span> : null}
        {provider.etd ? <span>ETD: {provider.etd} · </span> : null}
        {provider.transit_days != null ? <span>Transit: {provider.transit_days} day(s) · </span> : null}
        {provider.rating != null && provider.rating !== '' ? <span>Rating: {provider.rating} · </span> : null}
        {provider.cod != null ? <span>COD: {String(provider.cod)}</span> : null}
      </div>
      {provider.message ? (
        <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.15rem' }}>{provider.message}</div>
      ) : null}
    </button>
  );
}

const TransportSuggestion = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = location.state?.returnPath || '/create-po';
  const isSupplierFlow = returnPath === '/supplier-place-order';
  const backLabel = isSupplierFlow ? 'Back to Place order' : 'Back to Create PO';
  const returnNoun = isSupplierFlow ? 'Place order' : 'Create PO';
  const voiceSession = useVoiceSessionContext();
  const notifyTransportSelected = voiceSession?.notifyTransportSelected;

  const statePo = Array.isArray(location.state?.poGroups) ? location.state.poGroups : [];
  const draftPo = Array.isArray(location.state?.voiceCart?.poGroups)
    ? location.state.voiceCart.poGroups
    : Array.isArray(location.state?.voiceCart?.draft?.poGroups)
      ? location.state.voiceCart.draft.poGroups
      : [];
  const poGroups = statePo.length ? statePo : draftPo;
  const allPoGroups = Array.isArray(location.state?.allPoGroups) ? location.state.allPoGroups : poGroups;
  const focusTransportGroupId = String(
    location.state?.focusTransportGroupId || location.state?.focusVendorId || ''
  ).trim();
  const focusGroup = focusTransportGroupId
    ? poGroups.find((g) => String(g.transportGroupId || g.vendorId) === focusTransportGroupId) ||
      poGroups.find((g) => String(g.vendorId) === focusTransportGroupId)
    : null;
  const existingTransportSelection =
    location.state?.existingTransportSelection &&
    typeof location.state.existingTransportSelection === 'object'
      ? location.state.existingTransportSelection
      : null;
  const grandTotalAllPos =
    Number(location.state?.grandTotalAllPos) ||
    Number(location.state?.voiceCart?.grandTotalAllPos) ||
    poGroups.reduce((s, g) => s + (Number(g.total) || 0), 0);
  const requiredDate =
    location.state?.requiredDate || location.state?.voiceCart?.requiredDate || '';
  const hasGstin =
    location.state?.hasGstin != null
      ? Boolean(location.state.hasGstin)
      : Boolean(String(location.state?.voiceCart?.draft?.gstin || '').trim());
  const deliveryDestination =
    location.state?.deliveryDestination ||
    location.state?.voiceCart?.deliveryDestination ||
    'shipping';
  const shippingAddress =
    location.state?.shippingAddress || location.state?.voiceCart?.shippingAddress || {};
  const billingAddress =
    location.state?.billingAddress || location.state?.voiceCart?.billingAddress || {};
  const createdOrders = Array.isArray(location.state?.createdOrders) ? location.state.createdOrders : [];
  const incomingTransportSelection =
    location.state?.transportSelection && typeof location.state.transportSelection === 'object'
      ? location.state.transportSelection
      : null;

  const transportOrderCards =
    createdOrders.length > 0
      ? createdOrders.map((order) => ({
          key: order.id || order.orderNumber,
          vendorName: order.supplier || 'Supplier',
          total: order.totalAmount || 0,
          items: Array.isArray(order.items) ? order.items : []
        }))
      : poGroups.map((group) => ({
          key: getTransportGroupKey(group),
          vendorName: group.vendorName,
          total: group.total,
          items: Array.isArray(group.items) ? group.items : []
        }));

  const isIncomingSelfShip = React.useMemo(() => {
    const st = incomingTransportSelection;
    if (!st || typeof st !== 'object') return false;
    const by = st.byVendorId && typeof st.byVendorId === 'object' ? st.byVendorId : {};
    const expectedIds = poGroups.map((g) => getTransportGroupKey(g)).filter(Boolean);
    const values = Object.values(by).map((v) => String(v || '').trim().toLowerCase());
    if (expectedIds.length > 0 && expectedIds.every((id) => String(by[id] || '').trim())) {
      return values.every((v) => v === 'self ship' || v === 'self-ship');
    }
    const root = String(st.shippingProvider || '').trim().toLowerCase();
    return root === 'self ship' || root === 'self-ship';
  }, [incomingTransportSelection, poGroups]);

  const [selectedByVendorId, setSelectedByVendorId] = React.useState({});
  const [transportModeChoice, setTransportModeChoice] = React.useState(
    isIncomingSelfShip ? 'self_ship' : 'external'
  );

  const [logisticsLoading, setLogisticsLoading] = React.useState(false);
  const [logisticsError, setLogisticsError] = React.useState('');
  const [shipments, setShipments] = React.useState([]);
  const [deliveryPincode, setDeliveryPincode] = React.useState('');
  const [deliveryAddressUsed, setDeliveryAddressUsed] = React.useState(null);

  const quoteRequestKey = React.useMemo(
    () =>
      buildTransportQuoteCacheKey({
        poGroups,
        shippingAddress,
        billingAddress,
        deliveryDestination,
        hasGstin
      }),
    [poGroups, shippingAddress, billingAddress, deliveryDestination, hasGstin]
  );

  React.useEffect(() => {
    if (poGroups.length === 0) return;
    if (transportModeChoice === 'self_ship') {
      setLogisticsLoading(false);
      setLogisticsError('');
      setShipments([]);
      setDeliveryPincode('');
      setDeliveryAddressUsed(null);
      return;
    }
    const shipOk = isCompleteAddress(shippingAddress);
    const billOk = isCompleteAddress(billingAddress);
    const needBilling = hasGstin && deliveryDestination === 'billing';
    if (!shipOk || (needBilling && !billOk)) {
      setLogisticsError(
        `Shipping (and billing, if applicable) addresses are required for courier quotes. Go back to ${returnNoun} and open Transport suggestion again.`
      );
      return;
    }

    let cancelled = false;
    const ac = new AbortController();
    const longWait = setTimeout(() => ac.abort(), 150000);

    const load = async () => {
      setLogisticsLoading(true);
      setLogisticsError('');
      try {
        const data = await fetchTransportQuotes({
          poGroups,
          shippingAddress,
          billingAddress,
          deliveryDestination,
          hasGstin,
          signal: ac.signal,
          cacheKey: quoteRequestKey
        });
        if (cancelled) return;
        const deliverForm =
          hasGstin && deliveryDestination === 'billing' ? billingAddress : shippingAddress;
        setDeliveryAddressUsed(
          data.deliveryAddress && data.deliveryAddress.line1
            ? data.deliveryAddress
            : data.deliveryPincode
              ? {
                  line1: deliverForm.line1,
                  city: deliverForm.city,
                  state: deliverForm.state,
                  country: deliverForm.country,
                  pincode: String(data.deliveryPincode)
                }
              : null
        );
        setDeliveryPincode(String(data.deliveryPincode || ''));
        setShipments(Array.isArray(data.shipments) ? data.shipments : []);
      } catch (e) {
        if (cancelled) return;
        const aborted = e?.name === 'AbortError';
        setLogisticsError(
          aborted
            ? 'Request stopped after 2.5 minutes. Courier APIs can be slow on first load—retry, or ask your team to raise LOGISTICS_UPSTREAM_TIMEOUT_MS on the server.'
            : e?.message || 'Network error loading transport options.'
        );
        setShipments([]);
        setDeliveryAddressUsed(null);
      } finally {
        clearTimeout(longWait);
        if (!cancelled) setLogisticsLoading(false);
      }
    };

    const scheduleId = setTimeout(() => {
      if (!cancelled) void load();
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(scheduleId);
      ac.abort();
    };
  }, [poGroups, quoteRequestKey, transportModeChoice, returnNoun]);

  /** Vendors that returned at least one transport option (must pick per vendor). */
  const vendorIdsRequiringTransport = React.useMemo(() => {
    const fromQuotes = [];
    for (const s of shipments || []) {
      const key = getTransportGroupKey(s);
      if (!key) continue;
      const providers = s?.logistics?.providers;
      if (s?.logistics?.success && Array.isArray(providers) && providers.length > 0) {
        fromQuotes.push(key);
      }
    }
    if (fromQuotes.length) return [...new Set(fromQuotes)];
    return [...new Set((poGroups || []).map((g) => getTransportGroupKey(g)).filter(Boolean))];
  }, [shipments, poGroups]);

  const pickProviderByKey = (transportKey, selectionKey) => {
    const s = shipments.find((x) => getTransportGroupKey(x) === String(transportKey));
    if (!s?.logistics?.success || !Array.isArray(s.logistics.providers)) return null;
    return s.logistics.providers.find((p) => providerSelectionKey(p) === selectionKey) || null;
  };

  const allTransportChosen =
    transportModeChoice === 'self_ship'
      ? poGroups.length > 0
      :
    vendorIdsRequiringTransport.length === 0 ||
    vendorIdsRequiringTransport.every((id) => String(selectedByVendorId[id] || '').trim());

  const selectedProviderOverCapacity = React.useMemo(() => {
    if (transportModeChoice === 'self_ship') return null;
    for (const vid of vendorIdsRequiringTransport) {
      const selKey = String(selectedByVendorId[vid] || '').trim();
      if (!selKey) continue;
      const p = pickProviderByKey(vid, selKey);
      if (p?.capacity_exceeded) return { vendorId: vid, provider: p };
    }
    return null;
  }, [transportModeChoice, vendorIdsRequiringTransport, selectedByVendorId, shipments]);

  const vendorDisplayName = (transportKey) => {
    const s = shipments.find((x) => getTransportGroupKey(x) === String(transportKey));
    if (s?.vendorName) return s.vendorName;
    const g =
      poGroups.find((x) => getTransportGroupKey(x) === String(transportKey)) ||
      poGroups.find((x) => String(x.vendorId) === String(transportKey));
    return g?.vendorName || transportKey;
  };

  const otherConfiguredSuppliers = React.useMemo(() => {
    if (!existingTransportSelection?.byVendorId) return [];
    const activeIds = new Set(poGroups.map((g) => getTransportGroupKey(g)).filter(Boolean));
    return Object.entries(existingTransportSelection.byVendorId)
      .filter(([transportKey, label]) => !activeIds.has(String(transportKey)) && String(label || '').trim())
      .map(([transportKey, label]) => {
        const fromAll =
          allPoGroups.find((g) => getTransportGroupKey(g) === String(transportKey)) ||
          allPoGroups.find((g) => String(g.vendorId) === String(transportKey));
        return {
          vendorId: transportKey,
          vendorName: fromAll?.vendorName || label,
          label,
          detail: getVendorTransportDetail(existingTransportSelection, transportKey)
        };
      });
  }, [existingTransportSelection, poGroups, allPoGroups]);

  const vendorIdsToMerge = () =>
    poGroups.map((g) => getTransportGroupKey(g)).filter(Boolean);

  const finishTransportNavigation = async (transportSelection) => {
    const ids = vendorIdsToMerge();
    const mergedSelection = mergeTransportSelections(existingTransportSelection, transportSelection, ids);
    const persisted = isSupplierFlow
      ? mergedSelection
      : await saveCartTransportSelection(mergedSelection, ids);
    if (isVoiceGuidedActive() && typeof notifyTransportSelected === 'function') {
      notifyTransportSelected(persisted);
    }
    navigate(returnPath, {
      replace: returnPath === '/supplier-place-order',
      state: {
        transportSelection: persisted,
        transportVendorIds: ids,
        createdOrders,
        poGroups: allPoGroups,
        grandTotalAllPos:
          Number(location.state?.grandTotalAllPos) ||
          allPoGroups.reduce((s, g) => s + (Number(g.total) || 0), 0),
        requiredDate,
        hasGstin,
        deliveryDestination,
        shippingAddress,
        billingAddress,
        voiceGuided: isVoiceGuidedActive()
      }
    });
  };

  const handleUseTransport = () => {
    if (transportModeChoice === 'self_ship') {
      const byVendorId = {};
      const byVendorCourierDetail = {};
      for (const g of poGroups) {
        const id = getTransportGroupKey(g);
        if (!id) continue;
        byVendorId[id] = SELF_SHIP_PROVIDER_NAME;
        byVendorCourierDetail[id] = {
          name: SELF_SHIP_PROVIDER_NAME,
          transport_mode: 'self_ship',
          transportMode: 'self_ship',
          source: 'self_ship',
          courier_company_id: null,
          vehicle_type_id: null,
          vehicleTypeId: null,
          rate: null,
          fareValue: null,
          etd: null
        };
      }
      const transportSelection = {
        byVendorId,
        byVendorCourierDetail,
        shippingProvider: '',
        trackingNumber: '',
        trackingUrl: '',
        transportNotes: 'Self ship by supplier'
      };
      finishTransportNavigation(transportSelection);
      return;
    }

    if (vendorIdsRequiringTransport.length === 0) {
      window.alert('No transport quotes are available yet. Fix quote errors or try again later.');
      return;
    }
    const missing = vendorIdsRequiringTransport.filter((id) => !String(selectedByVendorId[id] || '').trim());
    if (missing.length > 0) {
      window.alert(
        `Choose transport for each supplier with quotes:\n${missing.map((id) => `• ${vendorDisplayName(id)}`).join('\n')}`
      );
      return;
    }
    if (selectedProviderOverCapacity) {
      window.alert(
        `${vendorDisplayName(selectedProviderOverCapacity.vendorId)}: selected vehicle exceeds capacity. Choose another option or split the shipment.`
      );
      return;
    }

    const byVendorId = {};
    const byVendorCourierDetail = {};
    for (const g of poGroups) {
      const id = getTransportGroupKey(g);
      if (!id) continue;
      const selKey = String(selectedByVendorId[id] || '').trim();
      if (!selKey) continue;
      const p = pickProviderByKey(id, selKey);
      const sh = shipments.find((x) => getTransportGroupKey(x) === String(id));
      const displayName = String(p?.name || '').trim() || selKey;
      byVendorId[id] = displayName;
      const isTrucking =
        p?.transportKind === 'trucking' ||
          String(p?.source || '').toLowerCase() === 'borzo' ||
          p?.vehicle_type_id != null;
      const fareValue = providerFareInr(p);
      byVendorCourierDetail[id] = {
        name: displayName,
        transport_mode: isTrucking ? 'trucking' : 'courier',
        transportMode: isTrucking ? 'trucking' : 'courier',
        courier_company_id: isTrucking ? null : (p?.courier_company_id ?? null),
        vehicle_type_id: isTrucking ? (p?.vehicle_type_id ?? null) : null,
        vehicleTypeId: isTrucking ? (p?.vehicle_type_id ?? null) : null,
        carrier: isTrucking ? p?.carrier || 'Borzo' : p?.carrier ?? null,
        fareValue,
        rate: fareValue ?? p?.rate ?? p?.estimated_fare ?? p?.fare_value ?? null,
        etd: p?.etd ?? null,
        transit_days: p?.transit_days ?? null,
        transitDays: p?.transit_days ?? null,
        transportGroupId: sh?.transportGroupId || id,
        pickupPincode: sh?.pickupPincode ?? g?.pickupPincode ?? null,
        booking_hints: sh?.logistics?.bookingHints ?? null,
        source: p?.source ?? null,
        rating: p?.rating ?? null,
        cod: p?.cod ?? null,
        weightKg: sh?.weightKg ?? sh?.logistics?.aggregatedWeightKg ?? null,
        lane: sh?.lane ?? sh?.logistics?.lane ?? null,
        pickup_lat: sh?.pickupLat ?? null,
        pickup_lng: sh?.pickupLng ?? null,
        delivery_lat: sh?.deliveryLat ?? null,
        delivery_lng: sh?.deliveryLng ?? null
      };
    }

    const transportSelection = {
      byVendorId,
      byVendorCourierDetail,
      shippingProvider: '',
      trackingNumber: '',
      trackingUrl: '',
      transportNotes: ''
    };

    finishTransportNavigation(transportSelection);
  };

  return (
    <SpWorkflowPage
      title={focusGroup ? `Transport — ${focusGroup.vendorName}` : 'Transport suggestion'}
      description={
        focusGroup
          ? `Choose courier, trucking, or self ship for ${focusGroup.vendorName}. Items from the same supplier are shipped together.`
          : 'Review courier (Shiprocket), trucking (Borzo), or Self ship — pick one option per supplier shipment.'
      }
      icon={Truck}
    >
    <div className="page !p-0">
      <VoiceGuidedBanner />

      {poGroups.length === 0 ? (
        <div
          style={{
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: '8px',
            padding: '1rem',
            color: '#92400e',
            marginBottom: '1rem'
          }}
        >
          No order data found. Please return to {returnNoun} and click Transport suggestion again.
        </div>
      ) : (
        <>
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '1rem',
              background: '#f8fafc',
              marginBottom: '1rem'
            }}
          >
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem' }}>
              {focusGroup
                ? `Supplier: ${focusGroup.vendorName}`
                : `Total vendors: ${poGroups.length}`}
            </div>
            {focusGroup ? (
              <div style={{ fontSize: '0.88rem', color: '#475569', marginBottom: '0.35rem' }}>
                {Array.isArray(focusGroup.items) ? focusGroup.items.length : 0} line item(s) clubbed for this
                supplier · Subtotal {formatCurrency(focusGroup.total)}
              </div>
            ) : null}
            <div style={{ fontWeight: 700, color: '#4f46e5', marginBottom: '0.25rem' }}>
              Grand total: {formatCurrency(grandTotalAllPos)}
            </div>
            <div style={{ fontSize: '0.9rem', color: '#334155' }}>
              Required by: {requiredDate || 'Not specified'}
            </div>
            <div style={{ fontSize: '0.9rem', color: '#334155', marginTop: '0.2rem' }}>
              Delivery destination:{' '}
              {deliveryDestination === 'billing' && hasGstin ? 'Billing address' : 'Shipping address'}
            </div>
            {deliveryPincode ? (
              <div style={{ fontSize: '0.9rem', color: '#334155', marginTop: '0.2rem' }}>
                Delivery pincode (quotes): <strong>{deliveryPincode}</strong>
              </div>
            ) : null}
            <div style={{ fontSize: '0.9rem', color: '#334155', marginTop: '0.2rem' }}>
              Created orders: {createdOrders.length}
            </div>
          </div>

          {otherConfiguredSuppliers.length > 0 ? (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.75rem 0.85rem',
                border: '1px solid #bbf7d0',
                borderRadius: 10,
                background: '#f0fdf4'
              }}
            >
              <div style={{ fontWeight: 700, color: '#14532d', marginBottom: '0.35rem', fontSize: '0.9rem' }}>
                Transport already saved for other suppliers
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem', color: '#166534' }}>
                {otherConfiguredSuppliers.map((row) => (
                  <li key={row.vendorId}>
                    <strong>{row.vendorName}:</strong> {row.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.5rem', color: '#0f172a' }}>Transport options</h3>
            <div
              style={{
                marginBottom: '0.65rem',
                padding: '0.65rem 0.75rem',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                background: '#fff'
              }}
            >
              <div style={{ fontSize: '0.86rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.35rem' }}>
                Choose transport system
              </div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.86rem', color: '#334155' }}>
                <label>
                  <input
                    type="radio"
                    name="transport-mode-choice"
                    value="external"
                    checked={transportModeChoice === 'external'}
                    onChange={() => setTransportModeChoice('external')}
                  />{' '}
                  External transport service (from logistics module)
                </label>
                <label>
                  <input
                    type="radio"
                    name="transport-mode-choice"
                    value="self_ship"
                    checked={transportModeChoice === 'self_ship'}
                    onChange={() => setTransportModeChoice('self_ship')}
                  />{' '}
                  Self ship (supplier delivers directly)
                </label>
              </div>
            </div>
            {transportModeChoice === 'self_ship' ? (
              <div
                style={{
                  marginBottom: '0.65rem',
                  padding: '0.6rem 0.75rem',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  background: '#f0fdf4',
                  fontSize: '0.84rem',
                  color: '#166534'
                }}
              >
                Self ship selected. No external transport quote or booking will be requested from logistics module.
              </div>
            ) : null}
            {!logisticsLoading && !logisticsError && formatAddressLines(deliveryAddressUsed).length > 0 ? (
              <div
                style={{
                  marginBottom: '0.65rem',
                  padding: '0.55rem 0.65rem',
                  background: '#f1f5f9',
                  borderRadius: 8,
                  fontSize: '0.84rem',
                  color: '#334155'
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>Deliver-to (used for quotes)</div>
                {formatAddressLines(deliveryAddressUsed).map((line, idx) => (
                  <div key={`del-${idx}`}>{line}</div>
                ))}
              </div>
            ) : null}
            {transportModeChoice === 'external' && logisticsLoading ? (
              <p style={{ color: '#64748b', margin: 0 }}>
                Loading transport providers… (first request to couriers often takes 30s–2 minutes)
              </p>
            ) : null}
            {transportModeChoice === 'external' && logisticsError ? (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#991b1b',
                  borderRadius: 8,
                  padding: '0.75rem',
                  fontSize: '0.9rem'
                }}
              >
                {logisticsError}
              </div>
            ) : null}
            {transportModeChoice === 'external' && !logisticsLoading && !logisticsError && shipments.length === 0 ? (
              <p style={{ color: '#64748b', margin: 0 }}>No shipment lanes returned.</p>
            ) : null}

            {transportModeChoice === 'external' ? (
            <div style={{ display: 'grid', gap: '1rem', marginTop: '0.75rem' }}>
              {shipments.map((shipment) => (
                <div
                  key={getTransportGroupKey(shipment) || shipment.vendorName}
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: 12,
                    padding: '0.9rem',
                    background: '#fff'
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem' }}>
                    Shipment — {shipment.vendorName}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#475569', marginBottom: '0.5rem' }}>
                    Pickup pincode: <strong>{shipment.pickupPincode || '—'}</strong> · Chargeable weight:{' '}
                    <strong>
                      {shipment.logistics?.aggregatedWeightKg ?? shipment.weightKg ?? '—'} kg
                    </strong>
                    {shipment.lane || shipment.logistics?.lane ? (
                      <>
                        {' '}
                        · Lane: <strong>{shipment.lane || shipment.logistics.lane}</strong>
                      </>
                    ) : null}
                    {shipment.distanceKm != null || shipment.logistics?.distanceKm != null ? (
                      <>
                        {' '}
                        · Distance:{' '}
                        <strong>
                          {Number(shipment.distanceKm ?? shipment.logistics?.distanceKm).toFixed(1)} km
                        </strong>
                      </>
                    ) : null}
                    {shipment.logistics?.itemCount != null ? (
                      <>
                        {' '}
                        · Items: <strong>{shipment.logistics.itemCount}</strong>
                      </>
                    ) : null}
                    {shipment.logistics?.mode ? (
                      <>
                        {' '}
                        · Mode: <strong>{shipment.logistics.mode}</strong>
                      </>
                    ) : null}
                  </div>
                  {Array.isArray(shipment.logistics?.messages) && shipment.logistics.messages.length > 0 ? (
                    <div
                      style={{
                        fontSize: '0.78rem',
                        color: '#475569',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 8,
                        padding: '0.4rem 0.55rem',
                        marginBottom: '0.45rem'
                      }}
                    >
                      {shipment.logistics.messages.map((msg, idx) => (
                        <div key={`msg-${idx}`}>{msg}</div>
                      ))}
                    </div>
                  ) : null}
                  {shipment.pickupOutletName ? (
                    <div style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '0.25rem' }}>
                      Warehouse: <strong>{shipment.pickupOutletName}</strong>
                    </div>
                  ) : null}
                  {formatAddressLines(shipment.pickupAddress).length > 0 ? (
                    <div style={{ fontSize: '0.78rem', color: '#334155', marginBottom: '0.45rem' }}>
                      <div style={{ fontWeight: 600, marginBottom: '0.15rem' }}>Ship-from (used for quotes)</div>
                      {formatAddressLines(shipment.pickupAddress).map((line, idx) => (
                        <div key={`pu-${idx}`}>{line}</div>
                      ))}
                    </div>
                  ) : shipment.pickupAddressSummary ? (
                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.45rem' }}>
                      Ship-from: {shipment.pickupAddressSummary}
                    </div>
                  ) : null}
                  {shipment.logistics?.quoteNote ? (
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: '#1e40af',
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: 8,
                        padding: '0.45rem 0.55rem',
                        marginBottom: '0.45rem'
                      }}
                    >
                      {shipment.logistics.quoteNote}
                    </div>
                  ) : null}
                  <div style={{ display: 'grid', gap: '0.45rem', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                    {!shipment.logistics?.success ? (
                      <div
                        style={{
                          gridColumn: '1 / -1',
                          fontSize: '0.85rem',
                          color: '#b45309'
                        }}
                      >
                        {shipment.logistics?.message || 'No quotes for this lane.'}
                      </div>
                    ) : (
                      (shipment.logistics.providers || []).map((p, idx) => {
                        const vid = getTransportGroupKey(shipment);
                        const selKey = providerSelectionKey(p);
                        const selected = Boolean(
                          selKey && String(selectedByVendorId[vid] || '').trim() === selKey
                        );
                        const overCap = Boolean(p.capacity_exceeded);
                        return (
                          <TransportPickCard
                            key={`${vid}-${selKey || idx}`}
                            provider={p}
                            selected={selected}
                            disabled={overCap}
                            disabledReason="Exceeds vehicle capacity — split shipment or pick another option"
                            onPick={() =>
                              setSelectedByVendorId((prev) => ({
                                ...prev,
                                [vid]: selKey
                              }))
                            }
                          />
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
            ) : null}
            {transportModeChoice === 'external' && !logisticsLoading && !logisticsError && vendorIdsRequiringTransport.length > 0 ? (
              <div
                style={{
                  marginTop: '0.85rem',
                  padding: '0.55rem 0.75rem',
                  background: '#eef2ff',
                  border: '1px solid #c7d2fe',
                  borderRadius: 10,
                  fontSize: '0.88rem',
                  color: '#312e81'
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Selected transport (per supplier)</div>
                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {vendorIdsRequiringTransport.map((vid) => {
                    const selKey = String(selectedByVendorId[vid] || '').trim();
                    const p = selKey ? pickProviderByKey(vid, selKey) : null;
                    const label = p?.name || selKey;
                    return (
                      <li key={vid} style={{ marginBottom: '0.2rem' }}>
                        <strong>{vendorDisplayName(vid)}:</strong>{' '}
                        {label || <span style={{ color: '#64748b' }}>not selected yet</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {transportOrderCards.map((group) => (
              <div
                key={`transport-${group.key}`}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.85rem 0.9rem',
                  background: '#fff'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                  <strong style={{ color: '#0f172a' }}>{group.vendorName}</strong>
                  <span style={{ color: '#4f46e5', fontWeight: 700 }}>{formatCurrency(group.total)}</span>
                </div>
                <div style={{ marginTop: '0.25rem', fontSize: '0.84rem', color: '#475569' }}>
                  Line items: {group.items.length}
                </div>
                {group.items.length > 0 && (
                  <div style={{ marginTop: '0.55rem', display: 'grid', gap: '0.45rem' }}>
                    {group.items.map((item, idx) => (
                      <div
                        key={`${group.key}-${item.supplierProductId || item.productId || idx}`}
                        style={{ fontSize: '0.82rem', color: '#334155' }}
                      >
                        <div>
                          <strong>{item.name}</strong> · {item.quantity} {item.unit || 'nos'} ·{' '}
                          {formatCurrency(item.price)}
                        </div>
                        {normalizeSpecifications(item.specifications).length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.2rem' }}>
                            {normalizeSpecifications(item.specifications)
                              .slice(0, 6)
                              .map(([key, value]) => (
                                <span
                                  key={`${group.key}-${idx}-${key}`}
                                  style={{
                                    fontSize: '0.72rem',
                                    color: '#334155',
                                    background: '#f1f5f9',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '9999px',
                                    padding: '0.12rem 0.45rem'
                                  }}
                                >
                                  <strong>{key}:</strong> {value}
                                </span>
                              ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn-secondary" onClick={() => navigate(returnPath)}>
          {backLabel}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={handleUseTransport}
          disabled={poGroups.length === 0 || !allTransportChosen || Boolean(selectedProviderOverCapacity)}
        >
          Use selected transport
        </button>
      </div>
    </div>
    </SpWorkflowPage>
  );
};

export default TransportSuggestion;
