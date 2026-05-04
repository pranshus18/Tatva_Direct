export function globalErrorHandler(err, req, res, next) {
  console.error('Error:', err);

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

  return res.status(err.statusCode || 500).json({
    status: 'error',
    message: err.message || 'Internal server error'
  });
}
