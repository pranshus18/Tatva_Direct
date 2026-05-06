import express from 'express';
import { randomBytes } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

function generateToken() {
  // ~12 chars, URL-safe
  return randomBytes(9).toString('base64url');
}

function getFrontendBaseUrl(req) {
  const envUrl = String(process.env.FRONTEND_BASE_URL || '').trim();
  if (envUrl) return envUrl.replace(/\/$/, '');
  const origin = String(req.headers?.origin || '').trim();
  if (origin) return origin.replace(/\/$/, '');
  return '';
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) ? t <= Date.now() : false;
}

router.post('/', authenticateToken, async (req, res) => {
  try {
    const token = req.userId ? String(req.userId) : '';
    if (!token) return res.status(401).json({ status: 'error', message: 'Unauthorized' });

    const { data: cart, error: cartError } = await supabase
      .from('po_carts')
      .select('id, draft_payload, updated_at')
      .eq('service_provider_id', req.userId)
      .maybeSingle();
    if (cartError) throw cartError;
    if (!cart || !cart.draft_payload || (typeof cart.draft_payload !== 'object')) {
      return res.status(404).json({ status: 'error', message: 'Saved cart not found' });
    }

    const draftPayload = cart.draft_payload;
    const hasAnyContent =
      (Array.isArray(draftPayload?.items) && draftPayload.items.length > 0) ||
      (Array.isArray(draftPayload?.boqGroups) && draftPayload.boqGroups.length > 0) ||
      (draftPayload?.mode === 'supplier_upstream') ||
      (draftPayload && Object.keys(draftPayload).length > 0);

    if (!hasAnyContent) {
      return res.status(400).json({ status: 'error', message: 'Cart is empty, nothing to share' });
    }

    const ttlDaysRaw = Number(req.body?.ttlDays);
    const ttlDays = Number.isFinite(ttlDaysRaw) && ttlDaysRaw > 0 ? Math.min(Math.floor(ttlDaysRaw), 30) : 7;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    const modeFromDraft = String(draftPayload?.mode || '').trim();
    const cartMode = modeFromDraft || (req.user?.user_type === 'supplier' ? 'supplier_upstream' : 'service_provider_po');

    let created = null;
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const shareToken = generateToken();
      const insertResult = await supabase
        .from('cart_share_links')
        .insert({
          token: shareToken,
          created_by_user_id: req.userId,
          cart_mode: cartMode,
          draft_payload: draftPayload,
          expires_at: expiresAt
        })
        .select('token, expires_at')
        .single();

      if (!insertResult.error && insertResult.data) {
        created = insertResult.data;
        lastError = null;
        break;
      }
      lastError = insertResult.error;
    }

    if (!created) {
      throw new Error(lastError?.message || 'Failed to create share link');
    }

    const baseUrl = getFrontendBaseUrl(req);
    const shareUrl = baseUrl ? `${baseUrl}/c/${encodeURIComponent(created.token)}` : null;

    return res.json({
      status: 'success',
      token: created.token,
      expiresAt: created.expires_at,
      shareUrl
    });
  } catch (e) {
    return res.status(500).json({
      status: 'error',
      message: 'Failed to create cart share link',
      error: e?.message
    });
  }
});

router.get('/:token', async (req, res) => {
  try {
    const token = String(req.params?.token || '').trim();
    if (!token) return res.status(400).json({ status: 'error', message: 'Token is required' });

    const { data: row, error } = await supabase
      .from('cart_share_links')
      .select('token, cart_mode, draft_payload, expires_at, created_at')
      .eq('token', token)
      .maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ status: 'error', message: 'Shared cart not found' });
    if (isExpired(row.expires_at)) {
      return res.status(410).json({ status: 'error', message: 'This shared cart link has expired' });
    }

    return res.json({
      status: 'success',
      sharedCart: {
        token: row.token,
        mode: row.cart_mode || null,
        draft: row.draft_payload || {},
        expiresAt: row.expires_at || null,
        createdAt: row.created_at || null
      }
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: 'Failed to load shared cart', error: e?.message });
  }
});

router.post('/:token/apply', authenticateToken, async (req, res) => {
  try {
    const token = String(req.params?.token || '').trim();
    if (!token) return res.status(400).json({ status: 'error', message: 'Token is required' });

    const { data: row, error } = await supabase
      .from('cart_share_links')
      .select('draft_payload, expires_at')
      .eq('token', token)
      .maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ status: 'error', message: 'Shared cart not found' });
    if (isExpired(row.expires_at)) {
      return res.status(410).json({ status: 'error', message: 'This shared cart link has expired' });
    }

    const draftPayload = row.draft_payload && typeof row.draft_payload === 'object' ? row.draft_payload : {};
    const { data: saved, error: saveError } = await supabase
      .from('po_carts')
      .upsert(
        {
          service_provider_id: req.userId,
          draft_payload: draftPayload
        },
        { onConflict: 'service_provider_id' }
      )
      .select('id, updated_at')
      .single();
    if (saveError) throw saveError;

    return res.json({
      status: 'success',
      message: 'Shared cart applied to your account',
      cart: {
        id: saved?.id,
        updatedAt: saved?.updated_at
      }
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: 'Failed to apply shared cart', error: e?.message });
  }
});

export { router as cartShareRouter };

