import { normalizeCompanyInfoEntries } from '../../services/supplierChainProfileService.js';
import { normalizeBrandKey } from '../../services/supplyChainSharedService.js';
import { insertNotification } from '../../repositories/notificationsRepository.js';
import {
  adminBrandApproveSchema,
  adminBrandRejectSchema,
  adminBrandRequestSchema,
  adminSupplierChainApproveSchema,
  adminSupplierChainRejectSchema
} from '../../contracts/adminContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';

export function registerAdminBrandAndSupplyChainRoutes({ router, authenticateToken, isAdmin, supabase }) {
  // ==========================
  // Brand approval workflow
  // ==========================
  // List all brands (admin only)
  router.get('/brands/all', authenticateToken, isAdmin, async (req, res) => {
    try {
      const status = String(req.query?.status || '').trim().toLowerCase();

      let query = supabase
        .from('brands')
        .select(
          `
        *,
        requester:users!brands_requested_by_fkey (id, name, email, company),
        approver:users!brands_approved_by_fkey (id, name, email)
      `
        )
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;
      if (error) throw error;

      res.json({ status: 'success', brands: data || [] });
    } catch (error) {
      console.error('Get all brands error:', error);
      res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  });

  // List pending brand requests (admin only)
  router.get('/brands/pending', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('brands')
        .select(
          `
        *,
        requester:users!brands_requested_by_fkey (id, name, email, company)
      `
        )
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json({ status: 'success', brands: data || [] });
    } catch (error) {
      console.error('Get pending brands error:', error);
      res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  });

  // Approve a brand (admin only)
  router.post('/brands/:id/approve', authenticateToken, isAdmin, async (req, res) => {
    try {
      parseWithSchema(adminBrandApproveSchema, req.body || {});
      const nowIso = new Date().toISOString();
      const { data: brand, error } = await supabase
        .from('brands')
        .update({
          status: 'approved',
          approved_by: req.userId,
          approved_at: nowIso,
          rejection_reason: null,
          updated_at: nowIso
        })
        .eq('id', req.params.id)
        .select('*')
        .single();

      if (error || !brand) {
        return res.status(404).json({ status: 'error', message: 'Brand request not found' });
      }

      res.json({ status: 'success', message: 'Brand approved', brand });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Approve brand error:', error);
      res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  });

  // Reject a brand (admin only)
  router.post('/brands/:id/reject', authenticateToken, isAdmin, async (req, res) => {
    try {
      const nowIso = new Date().toISOString();
      const payload = parseWithSchema(adminBrandRejectSchema, req.body || {});
      const reason = String(payload.reason || 'Brand rejected by admin');

      const { data: brand, error } = await supabase
        .from('brands')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          approved_by: null,
          approved_at: null,
          updated_at: nowIso
        })
        .eq('id', req.params.id)
        .select('*')
        .single();

      if (error || !brand) {
        return res.status(404).json({ status: 'error', message: 'Brand request not found' });
      }

      res.json({ status: 'success', message: 'Brand rejected', brand });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Reject brand error:', error);
      res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  });

  // Create/ensure a brand request (admin-only helper; can be used by admin tools)
  router.post('/brands/request', authenticateToken, isAdmin, async (req, res) => {
    try {
      const payload = parseWithSchema(adminBrandRequestSchema, req.body || {});
      const name = String(payload.name || '').trim();
      const normalized = normalizeBrandKey(name);
      if (!name || !normalized) {
        return res.status(400).json({ status: 'error', message: 'Brand name is required' });
      }

      const { data: existing } = await supabase
        .from('brands')
        .select('*')
        .eq('normalized_name', normalized)
        .maybeSingle();

      if (existing) {
        return res.json({ status: 'success', message: 'Brand already exists', brand: existing });
      }

      const nowIso = new Date().toISOString();
      const { data: created, error } = await supabase
        .from('brands')
        .insert({
          name,
          normalized_name: normalized,
          status: 'pending',
          requested_by: req.userId,
          requested_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso
        })
        .select('*')
        .single();

      if (error) throw error;
      res.json({ status: 'success', message: 'Brand request created', brand: created });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Create brand request error:', error);
      res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  });

  // ==========================
  // Supplier supply-chain profile (role + brands) — admin approves assignment
  // ==========================
  router.get('/supplier-chain-requests', authenticateToken, isAdmin, async (req, res) => {
    try {
      const status = String(req.query?.status || 'pending').trim().toLowerCase();
      let query = supabase
        .from('supplier_chain_profile_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      const { data: rows, error } = await query;
      if (error) throw error;

      const userIds = [...new Set((rows || []).map((r) => r.user_id).filter(Boolean))];
      const userMap = {};
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, name, email, company, user_type')
          .in('id', userIds);
        (users || []).forEach((u) => {
          userMap[u.id] = u;
        });
      }

      const requests = (rows || []).map((r) => ({
        ...r,
        user: userMap[r.user_id] || null
      }));

      res.json({ status: 'success', requests });
    } catch (error) {
      console.error('List supplier-chain-requests error:', error);
      res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
    }
  });

  router.post('/supplier-chain-requests/:id/approve', authenticateToken, isAdmin, async (req, res) => {
    const requestId = req.params.id;
    const nowIso = new Date().toISOString();
    try {
      parseWithSchema(adminSupplierChainApproveSchema, req.body || {});
      const { data: reqRow, error: rErr } = await supabase
        .from('supplier_chain_profile_requests')
        .select('*')
        .eq('id', requestId)
        .eq('status', 'pending')
        .maybeSingle();

      if (rErr) throw rErr;
      if (!reqRow) {
        return res.status(404).json({ status: 'error', message: 'Pending request not found' });
      }

      const payload = reqRow.payload || {};
      const entries = normalizeCompanyInfoEntries(payload.companyInfoEntries || []);

      const { data: userRow, error: uErr } = await supabase
        .from('users')
        .select('id, profile')
        .eq('id', reqRow.user_id)
        .single();

      if (uErr || !userRow) {
        return res.status(404).json({ status: 'error', message: 'Supplier not found' });
      }

      const mergedProfile = {
        ...(userRow.profile || {}),
        supplierRole: String(payload.supplierRole || '').trim(),
        brands: typeof payload.brands === 'string' ? payload.brands : '',
        companyInfoEntries: entries
      };

      const { error: upUserErr } = await supabase
        .from('users')
        .update({ profile: mergedProfile })
        .eq('id', reqRow.user_id);

      if (upUserErr) throw upUserErr;

      const { error: upReqErr } = await supabase
        .from('supplier_chain_profile_requests')
        .update({
          status: 'approved',
          reviewed_by: req.userId,
          reviewed_at: nowIso,
          updated_at: nowIso,
          rejection_reason: null
        })
        .eq('id', requestId);

      if (upReqErr) throw upReqErr;

      try {
        await insertNotification({
          user_id: reqRow.user_id,
          type: 'supplier_chain_profile_approved',
          title: 'Supply-chain profile approved',
          message:
          'An admin approved your supply-chain role and brand assignment. It is now active on the platform.',
          related_supplier_id: reqRow.user_id,
          is_read: false,
          metadata: { requestId }
        }, supabase);
      } catch (notifErr) {
        console.error('[Admin] chain approve notification:', notifErr);
      }

      res.json({ status: 'success', message: 'Profile assignment approved and applied' });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Approve supplier-chain-request error:', error);
      res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
    }
  });

  router.post('/supplier-chain-requests/:id/reject', authenticateToken, isAdmin, async (req, res) => {
    const requestId = req.params.id;
    const nowIso = new Date().toISOString();
    try {
      const payload = parseWithSchema(adminSupplierChainRejectSchema, req.body || {});
      const reason = String(payload.reason || '').trim() || 'Rejected by admin';
      const { data: reqRow, error: rErr } = await supabase
        .from('supplier_chain_profile_requests')
        .select('id, user_id')
        .eq('id', requestId)
        .eq('status', 'pending')
        .maybeSingle();

      if (rErr) throw rErr;
      if (!reqRow) {
        return res.status(404).json({ status: 'error', message: 'Pending request not found' });
      }

      const { error: upErr } = await supabase
        .from('supplier_chain_profile_requests')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          reviewed_by: req.userId,
          reviewed_at: nowIso,
          updated_at: nowIso
        })
        .eq('id', requestId);

      if (upErr) throw upErr;

      try {
        await insertNotification({
          user_id: reqRow.user_id,
          type: 'supplier_chain_profile_rejected',
          title: 'Supply-chain profile not approved',
          message: `An admin rejected your supply-chain profile changes. Reason: ${reason}`,
          related_supplier_id: reqRow.user_id,
          is_read: false,
          metadata: { requestId }
        }, supabase);
      } catch (notifErr) {
        console.error('[Admin] chain reject notification:', notifErr);
      }

      res.json({ status: 'success', message: 'Request rejected' });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Reject supplier-chain-request error:', error);
      res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
    }
  });
}
