import {
  approveBrandReviewItem,
  buildBrandReviewItems,
  rejectBrandReviewItem,
  syncPendingRequestPayloads
} from '../../services/supplierChainAdminService.js';
import {
  normalizeCompanyInfoEntries,
  syncApprovedBrandsIntoUserProfile
} from '../../services/supplierChainProfileService.js';
import {
  consolidateDuplicateBrands,
  findBrandByCatalogDedupKey,
  getCanonicalBrandNormalizedName,
  pickCanonicalBrandDisplayName
} from '../../services/brandDedupService.js';
import { notifySupplierBrandRejected } from '../../services/brandApprovalService.js';
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

      try {
        await consolidateDuplicateBrands(supabase);
      } catch (consolidateError) {
        console.error('Consolidate duplicate brands error:', consolidateError);
      }

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

      const { data: existingRow, error: existingError } = await supabase
        .from('brands')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle();

      if (existingError || !existingRow) {
        return res.status(404).json({ status: 'error', message: 'Brand request not found' });
      }

      const { data: duplicateApproved } = await findBrandByCatalogDedupKey(existingRow.name, supabase, {
        excludeId: existingRow.id
      });
      if (duplicateApproved && String(duplicateApproved.status || '').toLowerCase() === 'approved') {
        // Merge into the canonical approved brand instead of rejecting the supplier request.
        // Rejecting-as-duplicate previously blocked Step 2 for the same brand identity.
        const canonicalName = pickCanonicalBrandDisplayName(existingRow.name, duplicateApproved.name);
        const canonicalNormalized = getCanonicalBrandNormalizedName(canonicalName);
        const nowIso = new Date().toISOString();
        const { data: mergedBrand, error: mergeError } = await supabase
          .from('brands')
          .update({
            name: canonicalName,
            normalized_name: canonicalNormalized,
            status: 'approved',
            approved_by: req.userId,
            approved_at: nowIso,
            rejection_reason: null,
            updated_at: nowIso
          })
          .eq('id', existingRow.id)
          .select('*')
          .single();

        if (mergeError) throw mergeError;

        if (mergedBrand?.requested_by) {
          try {
            const { data: requester, error: requesterError } = await supabase
              .from('users')
              .select('profile')
              .eq('id', mergedBrand.requested_by)
              .maybeSingle();
            if (!requesterError && requester) {
              await syncApprovedBrandsIntoUserProfile(mergedBrand.requested_by, requester.profile || {});
            }
          } catch (syncError) {
            console.error('Sync merged approved brand into supplier profile:', syncError);
          }

          try {
            await insertNotification(
              {
                user_id: mergedBrand.requested_by,
                type: 'brand_approved',
                title: `Brand approved: ${canonicalName}`,
                message: `Admin approved your brand request as "${canonicalName}". You can now select your supply-chain role in Select yourself.`,
                metadata: {
                  source: 'admin_brand_approve_merge',
                  brandId: mergedBrand.id,
                  brandName: canonicalName,
                  canonicalBrandId: duplicateApproved.id
                },
                is_read: false
              },
              supabase
            );
          } catch (notifErr) {
            console.error('[Admin] merged brand approve notification:', notifErr);
          }
        }

        return res.json({
          status: 'success',
          message: `Brand approved as "${canonicalName}" (merged with existing catalog entry).`,
          brand: mergedBrand || duplicateApproved,
          mergedDuplicate: true
        });
      }

      const nowIso = new Date().toISOString();
      const canonicalName = pickCanonicalBrandDisplayName(existingRow.name);
      const canonicalNormalized = getCanonicalBrandNormalizedName(canonicalName);
      const { data: brand, error } = await supabase
        .from('brands')
        .update({
          name: canonicalName,
          normalized_name: canonicalNormalized,
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

      if (brand.requested_by) {
        try {
          const { data: requester, error: requesterError } = await supabase
            .from('users')
            .select('profile')
            .eq('id', brand.requested_by)
            .maybeSingle();
          if (!requesterError && requester) {
            await syncApprovedBrandsIntoUserProfile(brand.requested_by, requester.profile || {});
          }
        } catch (syncError) {
          console.error('Sync approved brand into supplier profile:', syncError);
        }
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

      if (brand.requested_by) {
        try {
          await notifySupplierBrandRejected({ supabase, brand, reason });
        } catch (notifErr) {
          console.error('[Admin] brand reject notification:', notifErr);
        }
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
      const normalized = getCanonicalBrandNormalizedName(name);
      if (!name || !normalized) {
        return res.status(400).json({ status: 'error', message: 'Brand name is required' });
      }

      const { data: existing } = await findBrandByCatalogDedupKey(name, supabase);
      if (!existing) {
        const fallback = await supabase
          .from('brands')
          .select('*')
          .eq('normalized_name', normalized)
          .maybeSingle();
        if (fallback.data) {
          return res.json({ status: 'success', message: 'Brand already exists', brand: fallback.data });
        }
      } else {
        return res.json({ status: 'success', message: 'Brand already exists', brand: existing });
      }

      const nowIso = new Date().toISOString();
      const { data: created, error } = await supabase
        .from('brands')
        .insert({
          name: pickCanonicalBrandDisplayName(name),
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
      const status = String(req.query?.status || 'all').trim().toLowerCase();
      let query = supabase
        .from('supplier_chain_profile_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);

      if (status === 'pending' || status === 'rejected') {
        query = query.eq('status', status);
      }

      const { data: rows, error } = await query;
      if (error) throw error;

      const userMap = {};
      if (status === 'approved' || status === 'all') {
        const { data: suppliers, error: suppliersError } = await supabase
          .from('users')
          .select('id, name, email, company, user_type, profile')
          .eq('user_type', 'supplier');
        if (suppliersError) throw suppliersError;
        (suppliers || []).forEach((u) => {
          userMap[u.id] = u;
        });
      }

      const userIdsFromRows = [...new Set((rows || []).map((r) => r.user_id).filter(Boolean))];
      const missingUserIds = userIdsFromRows.filter((id) => !userMap[id]);
      if (missingUserIds.length > 0) {
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, name, email, company, user_type, profile')
          .in('id', missingUserIds);
        if (usersError) throw usersError;
        (users || []).forEach((u) => {
          userMap[u.id] = u;
        });
      }

      const requests = (rows || []).map((r) => ({
        ...r,
        user: userMap[r.user_id] || null
      }));

      if (status === 'pending' || status === 'all') {
        await syncPendingRequestPayloads(requests, userMap);
      }

      const brandItems = buildBrandReviewItems(requests, userMap, { statusFilter: status });

      res.json({ status: 'success', requests, brandItems });
    } catch (error) {
      console.error('List supplier-chain-requests error:', error);
      res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
    }
  });

  router.post('/supplier-chain-requests/:id/approve', authenticateToken, isAdmin, async (req, res) => {
    const requestId = req.params.id;
    const nowIso = new Date().toISOString();
    try {
      const body = parseWithSchema(adminSupplierChainApproveSchema, req.body || {});
      const entryId = String(body.entryId || '').trim();
      const brand = String(body.brand || '').trim();

      if (entryId || brand) {
        const result = await approveBrandReviewItem({
          requestId,
          entryId,
          brand,
          adminUserId: req.userId
        });
        if (!result.ok) {
          return res.status(result.code === 'not_found' ? 404 : 400).json({
            status: 'error',
            code: result.code,
            message: result.message
          });
        }

        try {
          const { data: reqRow } = await supabase
            .from('supplier_chain_profile_requests')
            .select('user_id')
            .eq('id', requestId)
            .maybeSingle();
          if (reqRow?.user_id) {
            await insertNotification({
              user_id: reqRow.user_id,
              type: 'supplier_chain_profile_approved',
              title: `Supply-chain role approved: ${result.brand}`,
              message: `An admin approved your ${result.role || 'supply-chain'} role for brand "${result.brand}".`,
              related_supplier_id: reqRow.user_id,
              is_read: false,
              metadata: { requestId, brand: result.brand, entryId }
            }, supabase);
          }
        } catch (notifErr) {
          console.error('[Admin] chain per-brand approve notification:', notifErr);
        }

        return res.json({
          status: 'success',
          message: `Approved ${result.role || 'role'} for brand "${result.brand}"`,
          brand: result.brand,
          remainingCount: result.remainingCount,
          requestClosed: result.requestClosed
        });
      }

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
      const payloadEntries = normalizeCompanyInfoEntries(payload.companyInfoEntries || []);

      const { data: userRow, error: uErr } = await supabase
        .from('users')
        .select('id, profile')
        .eq('id', reqRow.user_id)
        .single();

      if (uErr || !userRow) {
        return res.status(404).json({ status: 'error', message: 'Supplier not found' });
      }

      const existingProfile = userRow.profile || {};
      const existingEntries = normalizeCompanyInfoEntries(existingProfile.companyInfoEntries || []);
      const entries = payloadEntries.length > 0 ? payloadEntries : existingEntries;
      const firstEntry = entries[0] || {};
      const payloadRole = String(payload.supplierRole || '').trim();
      const payloadBrands = typeof payload.brands === 'string' ? payload.brands.trim() : '';
      const existingRole = String(existingProfile.supplierRole || '').trim();
      const existingBrands = typeof existingProfile.brands === 'string' ? existingProfile.brands.trim() : '';
      const finalEntries =
        entries.length > 0
          ? entries
          : normalizeCompanyInfoEntries([
              {
                role: payloadRole || existingRole || '',
                brands: payloadBrands || existingBrands || '',
                gstin: String(existingProfile.gstin || '').trim(),
                companyName: String(existingProfile.companyName || '').trim(),
                ownershipDetails: String(existingProfile.ownershipDetails || '').trim(),
                authorizationCertificateUrl: String(existingProfile.authorizationCertificateUrl || '').trim(),
                authorizationCertificateUrls: Array.isArray(existingProfile.authorizationCertificateUrls)
                  ? existingProfile.authorizationCertificateUrls
                  : [],
                minimumOrderValue: existingProfile.minimumOrderValue ?? ''
              }
            ]);

      const mergedProfile = {
        ...existingProfile,
        supplierRole:
          payloadRole ||
          firstEntry.role ||
          finalEntries[0]?.role ||
          existingRole ||
          '',
        brands:
          payloadBrands ||
          firstEntry.brands ||
          finalEntries[0]?.brands ||
          existingBrands ||
          '',
        companyInfoEntries: finalEntries
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
      const entryId = String(payload.entryId || '').trim();
      const brand = String(payload.brand || '').trim();

      if (entryId || brand) {
        const result = await rejectBrandReviewItem({
          requestId,
          entryId,
          brand,
          reason,
          adminUserId: req.userId
        });
        if (!result.ok) {
          return res.status(result.code === 'not_found' ? 404 : 400).json({
            status: 'error',
            code: result.code,
            message: result.message
          });
        }

        try {
          const { data: reqRow } = await supabase
            .from('supplier_chain_profile_requests')
            .select('user_id')
            .eq('id', requestId)
            .maybeSingle();
          if (reqRow?.user_id) {
            await insertNotification({
              user_id: reqRow.user_id,
              type: 'supplier_chain_profile_rejected',
              title: `Supply-chain change rejected: ${result.brand}`,
              message: `An admin rejected your supply-chain change for brand "${result.brand}". Reason: ${reason}`,
              related_supplier_id: reqRow.user_id,
              is_read: false,
              metadata: { requestId, brand: result.brand, entryId, reason }
            }, supabase);
          }
        } catch (notifErr) {
          console.error('[Admin] chain per-brand reject notification:', notifErr);
        }

        return res.json({
          status: 'success',
          message: `Rejected supply-chain change for brand "${result.brand}"`,
          brand: result.brand,
          remainingCount: result.remainingCount,
          requestClosed: result.requestClosed
        });
      }

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
