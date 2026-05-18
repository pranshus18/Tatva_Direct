import logger from '../utils/logger.js';

let isShuttingDown = false;

/**
 * Register process-level handlers so unhandled async errors are logged
 * instead of crashing the Node process silently in production.
 */
export function registerProcessSafety() {
  process.on('unhandledRejection', (reason) => {
    logger.error('[process] unhandledRejection', reason);
    const exitOnRejection = process.env.PROCESS_EXIT_ON_REJECTION === 'true';
    if (exitOnRejection && !isShuttingDown) {
      scheduleFatalExit('unhandledRejection');
    }
  });

  process.on('uncaughtException', (err) => {
    logger.error('[process] uncaughtException', err);
    if (!isShuttingDown) {
      scheduleFatalExit('uncaughtException');
    }
  });
}

function scheduleFatalExit(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.error(`[process] exiting due to ${signal}`);
  setTimeout(() => process.exit(1), 250).unref();
}

export function markProcessShuttingDown() {
  isShuttingDown = true;
}
