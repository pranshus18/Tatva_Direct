/**
 * Race a promise against a timeout. Clears the timer when the main promise settles first.
 */
export async function withRequestTimeout(promise, ms, label = 'request') {
  if (!ms || ms <= 0) return promise;

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.code = 'ETIMEDOUT';
      err.statusCode = 504;
      reject(err);
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
