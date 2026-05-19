import { supabase } from '../../config/supabase.js';
import * as dashboardHelpers from './shared/dashboardHelpers.js';

export function createDashboardRouteContext(router, authenticateToken) {
  return {
    router,
    authenticateToken,
    supabase,
    ...dashboardHelpers
  };
}
