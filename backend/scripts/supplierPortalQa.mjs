/**
 * Supplier portal API smoke + contract checks.
 * Usage: SUPPLIER_EMAIL=... SUPPLIER_PASSWORD=... node scripts/supplierPortalQa.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, '..');

function loadDotEnv() {
  const envPath = path.join(backendRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadDotEnv();

const BASE = process.env.API_BASE_URL || 'http://127.0.0.1:8081';
const EMAIL = process.env.SUPPLIER_EMAIL || 'karthik@gmail.com';
const PASSWORD = process.env.SUPPLIER_PASSWORD || process.env.SUPPLIER_PASS || 'karthik@123';

const results = [];

function record(id, status, notes = '') {
  results.push({ id, status, notes });
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○';
  console.log(`${icon} ${id}: ${status}${notes ? ` — ${notes}` : ''}`);
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === 'error') {
    throw new Error(data.message || `login failed ${res.status}`);
  }
  const userType = data.user?.user_type || data.user?.userType;
  if (userType !== 'supplier') {
    throw new Error(`expected supplier, got ${userType}`);
  }
  return data.token;
}

async function api(token, method, path, body) {
  const opts = {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function expect200(id, r, shapeCheck) {
  if (r.status !== 200) {
    record(id, 'FAIL', `HTTP ${r.status}: ${r.data?.message || ''}`);
    return null;
  }
  if (shapeCheck && !shapeCheck(r.data)) {
    record(id, 'FAIL', 'response shape mismatch');
    return null;
  }
  record(id, 'PASS');
  return r.data;
}

async function main() {
  console.log(`Supplier portal QA @ ${BASE} (${EMAIL})\n`);
  let token;
  try {
    token = await login();
    record('AUTH', 'PASS', 'supplier login');
  } catch (e) {
    record('AUTH', 'FAIL', e.message);
    printSummary();
    process.exit(1);
  }

  // Dashboard (frontend SupplierDashboard primary)
  const dash = await api(token, 'GET', '/api/dashboard/supplier');
  const dashData = expect200('DASH-01', dash, (d) => d.status === 'success' && d.stats && Array.isArray(d.orders));
  if (dashData) {
    const statsOk =
      typeof dashData.stats.totalProducts === 'number' &&
      typeof dashData.stats.activeOrders === 'number';
    record('DASH-02', statsOk ? 'PASS' : 'FAIL', `stats keys; orders=${dashData.orders.length}`);
  }

  const readEndpoints = [
    ['CAT-01', 'GET', '/api/supplier/categories', (d) => Array.isArray(d.categories) || Array.isArray(d)],
    ['CAT-02', 'GET', '/api/supplier/units', (d) => Array.isArray(d.units) || Array.isArray(d)],
    ['LOC-01', 'GET', '/api/supplier/locations', (d) => d.status === 'success' || Array.isArray(d.locations)],
    ['OUT-01', 'GET', '/api/supplier/outlets', (d) => d.status === 'success' || Array.isArray(d.outlets)],
    ['PRD-01', 'GET', '/api/supplier/products', (d) => d.status === 'success' || Array.isArray(d.products)],
    ['PRD-02', 'GET', '/api/supplier/products/search?q=cement&limit=5', (d) => Array.isArray(d.products) || d.status === 'success'],
    ['INV-01', 'GET', '/api/supplier/inventory/summary', (d) => d.status === 'success'],
    ['INV-02', 'GET', '/api/supplier/inventory/restock-suggestions?threshold=10&limit=3', (d) => d.status === 'success'],
    ['ORD-01', 'GET', '/api/supplier/orders', (d) => d.status === 'success' || Array.isArray(d.orders)],
    ['RET-01', 'GET', '/api/supplier/returns', (d) => d.status === 'success' || Array.isArray(d.returns)],
    ['NOT-01', 'GET', '/api/supplier/notifications', (d) => Array.isArray(d.notifications)],
    ['SET-01', 'GET', '/api/supplier/setup-status', (d) => d.status === 'success' || typeof d.setupComplete === 'boolean'],
    ['BCOV-01', 'GET', '/api/supplier/bcov-levels', (d) => d.status === 'success' || Array.isArray(d.levels)],
    ['UP-01', 'GET', '/api/supplier/upstream/cart', (d) => d.status === 'success'],
    ['UP-02', 'GET', '/api/supplier/upstream/orders', (d) => d.status === 'success' || Array.isArray(d.orders)],
    ['ANA-01', 'GET', '/api/supplier/analytics/discount-insights', (d) => d.status === 'success'],
    ['ANA-02', 'GET', '/api/supplier/analytics/buyer-purchases', (d) => d.status === 'success'],
    ['ANA-03', 'GET', '/api/supplier/analytics/sales-by-channel', (d) => d.status === 'success'],
    ['PAY-01', 'GET', '/api/payments/settlement/report', (d) => d.status === 'success' || d.report !== undefined]
  ];

  for (const [id, method, path, check] of readEndpoints) {
    const r = await api(token, method, path);
    expect200(id, r, check);
  }

  // Order detail if any order exists
  const ordersR = await api(token, 'GET', '/api/supplier/orders');
  const orderList = ordersR.data?.orders || ordersR.data?.data || [];
  const firstOrder = Array.isArray(orderList) ? orderList[0] : null;
  if (firstOrder?.id || firstOrder?.orderNumber) {
    const ref = encodeURIComponent(firstOrder.orderNumber || firstOrder.id);
    const detail = await api(token, 'GET', `/api/supplier/orders/${ref}`);
    expect200('ORD-02', detail, (d) => d.status === 'success' || d.order);
  } else {
    record('ORD-02', 'BLOCKED', 'no orders to fetch detail');
  }

  // Product lookup + TSIN field on list
  const productsR = await api(token, 'GET', '/api/supplier/products');
  const products = productsR.data?.products || [];
  if (products.length) {
    const p = products[0];
    const hasTsinFields = 'asin' in p && 'variantAsin' in p;
    record('PRD-03', hasTsinFields ? 'PASS' : 'FAIL', `asin=${p.asin || '—'}, variantAsin=${p.variantAsin || '—'}`);
    const name = p.name || p.product?.name;
    if (name) {
      const lookup = await api(token, 'GET', `/api/supplier/products/lookup?name=${encodeURIComponent(name)}&limit=3`);
      expect200('PRD-04', lookup, (d) => d.status === 'success' || Array.isArray(d.products) || Array.isArray(d.matches));
    }
    const spId = p.supplier_product_id || p.id;
    if (spId) {
      const hist = await api(token, 'GET', `/api/supplier/inventory/${spId}/history`);
      expect200('INV-03', hist, (d) => d.status === 'success' || Array.isArray(d.movements) || Array.isArray(d.history));
      const sug = await api(token, 'GET', `/api/supplier/upstream/suggestions?supplierProductIds=${spId}&limit=3`);
      expect200('UP-03', sug, (d) => d.status === 'success' || Array.isArray(d.suggestions));
    }
  } else {
    record('PRD-03', 'BLOCKED', 'no products');
    record('PRD-04', 'BLOCKED', 'no products');
    record('INV-03', 'BLOCKED', 'no products');
    record('UP-03', 'BLOCKED', 'no products');
  }

  // Validation: PATCH order status without body → 400 not 500
  const badStatus = await api(token, 'PATCH', '/api/supplier/orders/nonexistent-qa-id/status', {});
  record(
    'ORD-03',
    badStatus.status === 400 || badStatus.status === 404 ? 'PASS' : 'FAIL',
    `invalid status update → ${badStatus.status}`
  );

  // BCOV resolve-price with minimal payload
  const bcovResolve = await api(token, 'POST', '/api/supplier/bcov-levels/resolve-price', {
    brand: 'QA',
    quantity: 1,
    unit: 'piece',
    buyerPlatformCov: 0,
    buyerBrandCov: 0,
    buyerSupplierCov: 0
  });
  record(
    'BCOV-02',
    bcovResolve.status === 200 || bcovResolve.status === 400 ? 'PASS' : 'FAIL',
    `resolve-price → ${bcovResolve.status}`
  );

  // SP token must NOT access supplier-only write paths (authz)
  const spLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.SP_EMAIL || 'Nandini@gmail.com',
      password: process.env.SP_PASSWORD || 'Nandini@123'
    })
  });
  const spData = await spLogin.json().catch(() => ({}));
  if (spLogin.ok && spData.token) {
    const denied = await api(spData.token, 'POST', '/api/supplier/inventory/adjust', { supplier_product_id: 'x', delta: 1 });
    record('AUTHZ-01', denied.status === 403 || denied.status === 400 || denied.status === 404 ? 'PASS' : 'FAIL', `SP adjust inventory → ${denied.status}`);
  } else {
    record('AUTHZ-01', 'BLOCKED', 'SP login unavailable');
  }

  printSummary();
}

function printSummary() {
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const ran = results.filter((r) => r.status !== 'BLOCKED').length;
  const passRate = ran ? Math.round((counts.PASS / ran) * 100) : 0;
  console.log('\n--- Summary ---');
  console.log(JSON.stringify({ counts, passRatePct: passRate, total: results.length }, null, 2));
  if (counts.FAIL > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
