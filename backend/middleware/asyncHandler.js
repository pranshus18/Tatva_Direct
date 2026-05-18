/**
 * Wraps async Express handlers so rejected promises reach globalErrorHandler.
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
