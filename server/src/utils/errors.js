class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

function notFound(req, res, next) {
  res.status(404).json({ error: 'Route not found' });
}

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  if (process.env.NODE_ENV !== 'test') {
    console.error(err);
  }
  // Never leak internal error details; for expected errors (with a statusCode
  // and message from AppError) pass the message through.
  const isAppError = !!err.statusCode;
  const message = isAppError ? err.message : 'Internal server error';
  res.status(statusCode).json({ error: message });
}

module.exports = { AppError, notFound, errorHandler };
