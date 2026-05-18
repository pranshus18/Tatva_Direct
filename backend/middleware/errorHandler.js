import logger from '../utils/logger.js';

const isProduction = () => process.env.NODE_ENV === 'production';

export function globalErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  logger.error('Request error:', {
    message: err?.message,
    code: err?.code,
    name: err?.name,
    path: req?.originalUrl,
    method: req?.method
  });

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid JSON payload'
    });
  }

  if (err.name === 'ZodError') {
    return res.status(400).json({
      status: 'error',
      message: err.message || 'Validation failed'
    });
  }

  if (err.code === '23505') {
    return res.status(400).json({
      status: 'error',
      message: err.message || 'Duplicate entry'
    });
  }

  if (err.code === '23503') {
    return res.status(400).json({
      status: 'error',
      message: err.message || 'Referenced record does not exist'
    });
  }

  if (err.code === '23502') {
    return res.status(400).json({
      status: 'error',
      message: err.message || 'Required field is missing'
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      status: 'error',
      message: 'Token expired'
    });
  }

  const statusCode = err.statusCode || 500;
  const clientMessage = statusCode < 500 && err.message
    ? err.message
    : (isProduction() ? 'Internal server error' : (err.message || 'Internal server error'));

  return res.status(statusCode).json({
    status: 'error',
    message: clientMessage
  });
}
