const ALLOWED_PREFIXES = [
  '/api/supplier/products/search',
  '/api/supplier/products/lookup',
  '/api/po/cart',
  '/api/po/group',
  '/api/po/create',
  '/api/po/',
  '/api/dashboard/service-provider',
  '/api/profile',
  '/api/payments/',
  '/api/vendors/rank',
  '/api/substitutions/',
  '/api/logistics/',
  '/api/voice/'
];

const LOGISTICS_TIMEOUT_MS =
  Number.parseInt(String(process.env.VOICE_LOGISTICS_TIMEOUT_MS || '150000'), 10) || 150000;

const API_TIMEOUT_MS =
  Number.parseInt(String(process.env.VOICE_API_TIMEOUT_MS || '6000'), 10) || 6000;

function getApiBase() {
  const port = process.env.PORT || 8081;
  const explicit = String(process.env.VOICE_INTERNAL_API_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  return `http://127.0.0.1:${port}`;
}

export class InternalApiClient {
  constructor(token) {
    this.token = token;
    this.base = getApiBase();
  }

  validatePath(path) {
    if (!path.startsWith('/api/')) throw new Error('Path must start with /api/');
    if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
      throw new Error(`Path not allowed for voice agent: ${path}`);
    }
  }

  async request(method, path, { params = null, body = null, timeoutMs = null } = {}) {
    this.validatePath(path);
    let url = `${this.base}${path}`;
    if (params) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') qs.set(k, String(v));
      });
      const q = qs.toString();
      if (q) url += `?${q}`;
    }

    const controller = new AbortController();
    const limit =
      timeoutMs ||
      (path.startsWith('/api/logistics/') ? LOGISTICS_TIMEOUT_MS : API_TIMEOUT_MS);
    const timeout = setTimeout(() => controller.abort(), limit);

    let response;
    try {
      response = await fetch(url, {
        method: method.toUpperCase(),
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        return { ok: false, statusCode: 408, error: 'Request timed out', data: null };
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      data = { status: 'error', message: (await response.text()).slice(0, 500) };
    }

    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        error: data?.message || `HTTP ${response.status}`,
        data
      };
    }
    return { ok: true, statusCode: response.status, data };
  }

  get(path, params) {
    return this.request('GET', path, { params });
  }

  post(path, body, options = {}) {
    return this.request('POST', path, {
      body: body || {},
      timeoutMs: options.timeoutMs
    });
  }

  put(path, body) {
    return this.request('PUT', path, { body: body || {} });
  }

  patch(path, body) {
    return this.request('PATCH', path, { body: body || {} });
  }

  delete(path) {
    return this.request('DELETE', path);
  }
}
