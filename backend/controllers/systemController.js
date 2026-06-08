import { supabase } from '../config/supabase.js';
import { geocodeAddressNominatim, getDrivingDistanceMatrixKm } from '../utils/geoUtils.js';

function maskEmail(email) {
  const value = String(email || '').trim();
  if (!value.includes('@')) return null;
  const [name, domain] = value.split('@');
  const safeName = name.length <= 2 ? `${name[0] || '*'}*` : `${name.slice(0, 2)}***`;
  return `${safeName}@${domain}`;
}

function getSupabaseHost(url) {
  try {
    return new URL(String(url || '')).host || null;
  } catch {
    return null;
  }
}

export function getApiInfo(req, res) {
  return res.status(200).json({
    status: 'success',
    message: 'Tatva Direct API Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      admin: '/api/admin',
      dashboard: '/api/dashboard'
    }
  });
}

async function probeDatabase() {
  const { error } = await supabase.from('users').select('count').limit(1);
  const dbConnected = !error || error.code !== '42P01';
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    type: 'Supabase (PostgreSQL)',
    status: dbConnected ? 'connected' : 'disconnected',
    connected: dbConnected,
    ...(isProduction || !error ? {} : { error: error.message })
  };
}

export async function getHealth(req, res) {
  try {
    const database = await probeDatabase();
    return res.status(200).json({
      status: 'success',
      message: 'Server is running',
      timestamp: new Date().toISOString(),
      database,
      uptime: process.uptime()
    });
  } catch (error) {
    return res.status(200).json({
      status: 'success',
      message: 'Server is running',
      timestamp: new Date().toISOString(),
      database: {
        type: 'Supabase (PostgreSQL)',
        status: 'error',
        connected: false
      },
      uptime: process.uptime()
    });
  }
}

/** Readiness probe — returns 503 when the database is unreachable. */
export async function getHealthReady(req, res) {
  try {
    const database = await probeDatabase();
    const ready = database.connected;
    return res.status(ready ? 200 : 503).json({
      status: ready ? 'success' : 'error',
      message: ready ? 'Ready' : 'Database unavailable',
      timestamp: new Date().toISOString(),
      database,
      uptime: process.uptime()
    });
  } catch (error) {
    return res.status(503).json({
      status: 'error',
      message: 'Database unavailable',
      timestamp: new Date().toISOString(),
      database: {
        type: 'Supabase (PostgreSQL)',
        status: 'error',
        connected: false
      },
      uptime: process.uptime()
    });
  }
}

export function getEnvDebug(req, res) {
  return res.status(200).json({
    status: 'success',
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasSupabase: !!process.env.SUPABASE_URL,
      hasJWTSecret: !!process.env.JWT_SECRET,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      geminiKeyLength: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.length : 0,
      openAIKeyLength: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0,
      anthropicKeyLength: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.length : 0,
      adminEmail: process.env.ADMIN_EMAIL || null,
      hasAdminPassword: !!process.env.ADMIN_PASSWORD,
      adminPasswordLength: process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.length : 0
    }
  });
}

export function getRuntimeDebug(req, res) {
  const commitSha = process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || null;
  const serviceName = process.env.RENDER_SERVICE_NAME || null;
  const serviceId = process.env.RENDER_SERVICE_ID || null;
  const deployId = process.env.RENDER_DEPLOY_ID || null;
  const supabaseHost = getSupabaseHost(process.env.SUPABASE_URL);
  const adminEmailMasked = maskEmail(process.env.ADMIN_EMAIL);

  return res.status(200).json({
    status: 'success',
    runtime: {
      nodeEnv: process.env.NODE_ENV || null,
      serviceName,
      serviceId,
      deployId,
      commitSha,
      supabaseHost,
      hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      adminEmailMasked
    }
  });
}

export async function distanceDebug(req, res) {
  try {
    const fromAddress = String(req.query.from || '').trim();
    const toAddress = String(req.query.to || '').trim();
    if (!fromAddress || !toAddress) {
      return res.status(400).json({
        status: 'error',
        message: 'Both query params are required: from, to'
      });
    }

    const [fromGeo, toGeo] = await Promise.all([
      geocodeAddressNominatim(fromAddress),
      geocodeAddressNominatim(toAddress)
    ]);

    if (!fromGeo || !toGeo) {
      return res.status(422).json({
        status: 'error',
        message: 'Could not geocode one or both addresses',
        geocoded: {
          from: fromGeo || null,
          to: toGeo || null
        }
      });
    }

    const distancesKm = await getDrivingDistanceMatrixKm(fromGeo, [toGeo]);
    const distanceKm = typeof distancesKm?.[0] === 'number' ? distancesKm[0] : null;

    return res.status(200).json({
      status: 'success',
      from: { address: fromAddress, geo: fromGeo },
      to: { address: toAddress, geo: toGeo },
      distanceKm,
      distanceMeters: distanceKm != null ? Math.round(distanceKm * 1000) : null
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Failed to test distance',
      error: error.message
    });
  }
}
