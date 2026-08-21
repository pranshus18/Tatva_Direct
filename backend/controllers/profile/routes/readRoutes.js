import { requireAuthentication as authenticateToken } from '../../../middleware/authMiddleware.js';
import { supabase } from '../../../config/supabase.js';
import {
  createProfileResponse,
  formatShippingAddressDisplayName,
  normalizeShippingAddressEntry,
  parseBrandTokens,
  resolveChainRoleOptionsForBrands
} from '../profileHelpers.js';
import { syncPmCustomerProfileForUser } from '../../../services/pmUserService.js';
import {
  listPmShippingAddresses,
  mergeLocalAndPmShippingAddresses,
  resolvePmAddressAuth
} from '../../../services/pmAddressService.js';
import { readPmCredentialsFromRequest } from '../../../services/pmVaultService.js';

export function registerProfileReadRoutes(router) {
  router.get('/', authenticateToken, async (req, res) => {
    try {
      let { data: user, error } = await supabase.from('users').select('*').eq('id', req.userId).single();

      if (error || !user) {
        return res.status(404).json({
          status: 'error',
          message: 'User not found'
        });
      }

      if (user.user_type === 'service_provider' && user.phone) {
        user = await syncPmCustomerProfileForUser(user);
      }

      delete user.password;
      const profile = await createProfileResponse(user);
      const userType = String(user.user_type || profile.userType || '').toLowerCase();
      if (userType === 'service_provider' || userType === 'supplier') {
        try {
          const credentials = readPmCredentialsFromRequest(req);
          const auth = await resolvePmAddressAuth(user, credentials);
          const pmList = await listPmShippingAddresses(auth);
          if (pmList.length > 0) {
            const merged = mergeLocalAndPmShippingAddresses(
              profile.shippingAddresses || [],
              pmList.map((entry) => normalizeShippingAddressEntry(entry))
            ).map((entry, index) => {
              const normalized = normalizeShippingAddressEntry(entry);
              return {
                ...normalized,
                displayName: formatShippingAddressDisplayName(normalized, index)
              };
            });
            profile.shippingAddresses = merged;

            const localJson = JSON.stringify(user.profile?.shippingAddresses || []);
            const mergedJson = JSON.stringify(merged);
            if (localJson !== mergedJson) {
              const nextProfile = {
                ...(user.profile || {}),
                shippingAddresses: merged
              };
              if (userType === 'supplier') {
                nextProfile.branches = [];
              }
              await supabase.from('users').update({ profile: nextProfile }).eq('id', user.id);
            }
          }
        } catch (pmError) {
          console.warn('[PM address] list skipped:', pmError?.message || pmError);
        }
      }
      return res.json({
        status: 'success',
        profile
      });
    } catch (error) {
      console.error('Get profile error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Resolve available supplier roles from admin-approved brand supply chains.
  router.get('/supplier/chain-role-options', authenticateToken, async (req, res) => {
    try {
      const brandsRaw = String(req.query.brands || '');
      const brands = [...new Set(parseBrandTokens(brandsRaw))].filter(Boolean);
      const resolved = await resolveChainRoleOptionsForBrands(brands);
      return res.json({
        status: 'success',
        ...resolved
      });
    } catch (error) {
      console.error('supplier chain role options error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to resolve supply-chain role options'
      });
    }
  });
}
