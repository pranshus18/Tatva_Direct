import { requireAuthentication as authenticateToken } from '../../../middleware/authMiddleware.js';
import { supabase } from '../../../config/supabase.js';
import { sanitizeServiceProviderThemePrefs } from '../profileHelpers.js';

export function registerProfileThemeRoutes(router) {
  router.get('/service-provider/theme', authenticateToken, async (req, res) => {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('id, user_type, profile')
        .eq('id', req.userId)
        .single();
      if (error || !user) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }
      if (String(user.user_type) !== 'service_provider') {
        return res
          .status(403)
          .json({ status: 'error', message: 'Only service providers can access portal theme.' });
      }
      const theme = sanitizeServiceProviderThemePrefs(user?.profile?.serviceProviderPortalTheme || {});
      return res.json({ status: 'success', theme });
    } catch (error) {
      return res.status(500).json({ status: 'error', message: 'Failed to load portal theme.' });
    }
  });

  router.put('/service-provider/theme', authenticateToken, async (req, res) => {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('id, user_type, profile')
        .eq('id', req.userId)
        .single();
      if (error || !user) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }
      if (String(user.user_type) !== 'service_provider') {
        return res
          .status(403)
          .json({ status: 'error', message: 'Only service providers can update portal theme.' });
      }
      const theme = sanitizeServiceProviderThemePrefs(req.body || {});
      const nextProfile = {
        ...(user.profile || {}),
        serviceProviderPortalTheme: {
          ...theme,
          updatedAt: new Date().toISOString()
        }
      };
      const { error: updateError } = await supabase
        .from('users')
        .update({ profile: nextProfile })
        .eq('id', req.userId);
      if (updateError) {
        throw updateError;
      }
      return res.json({ status: 'success', theme });
    } catch (error) {
      return res.status(400).json({
        status: 'error',
        message: error?.message || 'Failed to save portal theme.'
      });
    }
  });
}
