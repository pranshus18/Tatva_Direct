const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

function currentLogLevel() {
  const envLevel = String(process.env.LOG_LEVEL || '').trim().toLowerCase();
  if (LOG_LEVELS.includes(envLevel)) return envLevel;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function shouldLog(level) {
  const configured = LOG_LEVELS.indexOf(currentLogLevel());
  const incoming = LOG_LEVELS.indexOf(level);
  if (incoming < 0) return true;
  return incoming >= configured;
}

export function debug(...args) {
  if (shouldLog('debug')) console.debug(...args);
}

export function info(...args) {
  if (shouldLog('info')) console.info(...args);
}

export function warn(...args) {
  if (shouldLog('warn')) console.warn(...args);
}

export function error(...args) {
  if (shouldLog('error')) console.error(...args);
}

export default { debug, info, warn, error };

