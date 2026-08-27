import { resolvePmApiEnvFromRequest, runWithPmRequestEnv } from '../config/pmApi.js';

/** Bind each request to devopsapi or opsapi from the Tatva frontend Origin. */
export function pmRequestEnvMiddleware(req, res, next) {
  const env = resolvePmApiEnvFromRequest(req);
  req.pmApiEnv = env;
  runWithPmRequestEnv(env, () => next());
}
