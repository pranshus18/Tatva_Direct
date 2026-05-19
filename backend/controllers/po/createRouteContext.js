import { supabase } from '../../config/supabase.js';
import * as poHelpers from './shared/poHelpers.js';

/** Runtime context for PO route modules. */
export function createPoRouteContext(router, authenticateToken, isServiceProvider) {
  return {
    router,
    authenticateToken,
    isServiceProvider,
    supabase,
    ...poHelpers
  };
}
