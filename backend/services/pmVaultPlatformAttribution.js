import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PM_PLATFORM_FLAG } from '../config/pmApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORE_PATH = path.join(__dirname, '..', 'data', 'pm-vault-platform-attribution.json');

function getStorePath() {
  return String(process.env.PM_VAULT_ATTRIBUTION_PATH || '').trim() || DEFAULT_STORE_PATH;
}

/** @type {Record<string, string> | null} */
let cache = null;
/** @type {string | null} */
let cachePath = null;

function normalizeKey(value) {
  const text = String(value || '').trim();
  return text || '';
}

function loadStore() {
  const storePath = getStorePath();
  if (cache && cachePath === storePath) return cache;
  try {
    if (fs.existsSync(storePath)) {
      const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      cache = raw && typeof raw === 'object' ? raw : {};
    } else {
      cache = {};
    }
  } catch {
    cache = {};
  }
  cachePath = storePath;
  return cache;
}

function persistStore() {
  const store = loadStore();
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

/**
 * Remember that a vault write was initiated by Tatva Direct.
 * PM payment services currently stamp row.flag as "tatvaops" even when we send tatvadirect;
 * we overlay the correct platform on reconciliation reads using these keys.
 */
export function rememberPmVaultPlatformAttribution(keys = {}, platform = PM_PLATFORM_FLAG) {
  const resolved = String(platform || PM_PLATFORM_FLAG || 'tatvadirect').trim() || 'tatvadirect';
  const store = loadStore();
  let changed = false;

  const candidates = [
    keys.razorpayPaymentId,
    keys.razorpayOrderId,
    keys.paymentId,
    keys.transactionId,
    keys.reference,
    keys.orderId,
    keys.orderNumber,
    ...(Array.isArray(keys.extra) ? keys.extra : [])
  ];

  for (const value of candidates) {
    const key = normalizeKey(value);
    if (!key) continue;
    if (store[key] === resolved) continue;
    store[key] = resolved;
    changed = true;
  }

  if (changed) persistStore();
  return changed;
}

export function lookupPmVaultPlatformAttribution(keys = []) {
  const store = loadStore();
  for (const value of keys) {
    const key = normalizeKey(value);
    if (key && store[key]) return store[key];
  }
  return null;
}

const RAZORPAY_PAY_ID_RE = /\b(pay_[A-Za-z0-9_]+)\b/;
const PLATFORM_IN_DETAILS_RE = /\b(tatvadirect|tatvaops)\b/i;

/**
 * Resolve the Platform column for a mapped PM vault transaction.
 * Prefer explicit attribution / details markers over PM's hardcoded tatvaops stamp.
 */
export function resolvePmVaultDisplayPlatform(row = {}) {
  const details = String(row.details || row.description || '');
  const payMatch = details.match(RAZORPAY_PAY_ID_RE);
  const attributed = lookupPmVaultPlatformAttribution([
    row.paymentId,
    payMatch?.[1],
    row.id,
    row.transaction_id,
    row.transactionId,
    row.reference,
    row.orderId,
    row.orderNumber
  ]);
  if (attributed) return attributed;

  const marker = details.match(PLATFORM_IN_DETAILS_RE);
  if (marker) return String(marker[1]).toLowerCase();

  const raw = String(row.flag || '').trim();
  return raw || null;
}

/** Apply Tatva Direct platform overlay onto mapped ledger rows. */
export function applyPmVaultPlatformAttribution(transactions = []) {
  return (Array.isArray(transactions) ? transactions : []).map((row) => ({
    ...row,
    flag: resolvePmVaultDisplayPlatform(row) || row.flag || null
  }));
}

export function extractAttributionKeysFromPmPayload(payload = {}) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return {
    razorpayPaymentId:
      data?.razorpay_payment_id ||
      data?.razorpayPaymentId ||
      data?.paymentId ||
      data?.payment_id ||
      null,
    razorpayOrderId:
      data?.razorpay_order_id ||
      data?.razorpayOrderId ||
      data?.orderId ||
      data?.order_id ||
      null,
    transactionId: data?.id || data?._id || data?.transactionId || data?.transaction_id || null,
    reference: data?.transactionId || data?.reference || data?.vtxId || null,
    paymentId: data?.paymentId || data?.payment_id || null,
    orderId: data?.orderId || data?.order_id || null,
    orderNumber: data?.orderNumber || data?.order_number || null
  };
}
