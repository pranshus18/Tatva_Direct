import fs from 'fs';
import path from 'path';

const baseDir = '/Users/abcom/Downloads/Tatva_pranshu-main/backend';
const baseUrl = process.env.API_BASE_URL || 'http://localhost:8081';
const skipPayments = process.env.SKIP_PAYMENTS === 'true';

const mappings = [
  ['controllers/authController.js', '/auth'],
  ['controllers/profileController.js', '/profile'],
  ['controllers/supplierController.js', '/supplier'],
  ['controllers/dashboardController.js', '/dashboard'],
  ['controllers/adminController.js', '/admin'],
  ['controllers/admin/productModerationRoutes.js', '/admin'],
  ['controllers/admin/userManagementRoutes.js', '/admin'],
  ['controllers/admin/platformOpsRoutes.js', '/admin'],
  ['controllers/admin/brandAndSupplyChainRoutes.js', '/admin'],
  ['controllers/admin/notificationRoutes.js', '/admin'],
  ['controllers/admin/productWorkflowRoutes.js', '/admin'],
  ['controllers/admin/adminAiEnhanceRoutes.js', '/admin'],
  ['controllers/adminSupplyChainController.js', '/admin/supply-chain'],
  ['controllers/boqController.js', '/boq'],
  ['controllers/vendorsController.js', '/vendors'],
  ['controllers/substitutionsController.js', '/substitutions'],
  ['controllers/poController.js', '/po'],
  ['controllers/posController.js', '/pos'],
  ['controllers/corePhase2Controller.js', '/core-phase2'],
  ['controllers/paymentsController.js', '/payments'],
  ['controllers/receiptsController.js', '/receipts'],
  ['routes/invoices.js', '/invoices']
];

const routeRegex = /(?:router|paymentsWebhookRouter)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;

function buildEndpoints() {
  const endpoints = [];
  for (const [relPath, prefix] of mappings) {
    const content = fs.readFileSync(path.join(baseDir, relPath), 'utf8');
    let match;
    while ((match = routeRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const routePath = match[2].replace(/:([A-Za-z0-9_]+)/g, (_full, name) => {
        const key = String(name).toLowerCase();
        if (key === 'id') return '00000000-0000-0000-0000-000000000000';
        return `sample-${name}`;
      });
      endpoints.push({
        method,
        url: `/api${prefix}${routePath.startsWith('/') ? routePath : `/${routePath}`}`,
        source: relPath
      });
    }
  }

  endpoints.push({ method: 'GET', url: '/api/health', source: 'routes/api.js' });
  endpoints.push({ method: 'GET', url: '/api/debug/env', source: 'routes/api.js' });
  endpoints.push({ method: 'GET', url: '/api/debug/distance-test', source: 'routes/api.js' });

  const dedup = new Map();
  for (const endpoint of endpoints) {
    dedup.set(`${endpoint.method} ${endpoint.url}`, endpoint);
  }

  let filteredEndpoints = [...dedup.values()];
  if (skipPayments) {
    filteredEndpoints = filteredEndpoints.filter((endpoint) => !endpoint.url.startsWith('/api/payments'));
  }
  return filteredEndpoints;
}

async function testEndpoint(endpoint, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const init = { method: endpoint.method, headers };
  if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
    init.body = '{}';
  }

  try {
    const res = await fetch(`${baseUrl}${endpoint.url}`, init);
    const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 160);
    return { ...endpoint, status: res.status, body };
  } catch (error) {
    return { ...endpoint, status: 'ERR', body: String(error.message || error) };
  }
}

async function main() {
  const endpoints = buildEndpoints();
  const token = process.env.API_TOKEN || '';
  const results = [];

  for (const endpoint of endpoints) {
    // Sequentially run to avoid hammering the running dev server.
    // This keeps logs easier to inspect if failures appear.
    // eslint-disable-next-line no-await-in-loop
    results.push(await testEndpoint(endpoint, token));
  }

  const success = results.filter((r) => typeof r.status === 'number' && r.status >= 200 && r.status < 300);
  const authExpected = results.filter((r) => r.status === 401 || r.status === 403);
  const notFound = results.filter((r) => r.status === 404);
  const serverErrors = results.filter((r) => typeof r.status === 'number' && r.status >= 500);
  const requestErrors = results.filter((r) => r.status === 'ERR');

  const output = {
    baseUrl,
    mode: token ? 'authenticated' : 'unauthenticated',
    skipPayments,
    total: results.length,
    success: success.length,
    authExpected: authExpected.length,
    notFound: notFound.length,
    serverErrors: serverErrors.length,
    requestErrors: requestErrors.length,
    serverErrorDetails: serverErrors.slice(0, 40),
    requestErrorDetails: requestErrors.slice(0, 40),
    notFoundDetails: notFound.slice(0, 40),
    successSamples: success.slice(0, 20)
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
