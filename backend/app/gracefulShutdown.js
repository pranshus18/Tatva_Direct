import logger from '../utils/logger.js';
import { markProcessShuttingDown } from '../middleware/processSafety.js';

/**
 * Register SIGINT/SIGTERM handlers for HTTP server graceful shutdown.
 */
export function setupGracefulShutdown(server) {
  let isShuttingDown = false;
  let forceCloseTimer = null;

  function shutdown(signal) {
    if (isShuttingDown) {
      logger.info(` ${signal} received again, forcing exit`);
      process.exit(1);
      return;
    }
    isShuttingDown = true;
    markProcessShuttingDown();
    logger.info(` ${signal} received, shutting down gracefully`);

    forceCloseTimer = setTimeout(() => {
      logger.warn(' Force exiting: graceful shutdown timed out');
      process.exit(1);
    }, 5000);

    server.close(() => {
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
      logger.info(' Server closed');
      logger.info(' Supabase connection closed');
      process.exit(0);
    });

    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
  }

  const shutdownHandlers = globalThis.__tatvaShutdownHandlers || {};
  if (shutdownHandlers.sigint) process.removeListener('SIGINT', shutdownHandlers.sigint);
  if (shutdownHandlers.sigterm) process.removeListener('SIGTERM', shutdownHandlers.sigterm);

  const handleSigint = () => shutdown('SIGINT');
  const handleSigterm = () => shutdown('SIGTERM');
  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);
  globalThis.__tatvaShutdownHandlers = { sigint: handleSigint, sigterm: handleSigterm };
}
