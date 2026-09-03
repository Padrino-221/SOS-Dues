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
  res.status(statusCode).json({ error: err.message || 'Internal server error' });
}

module.exports = { AppError, notFound, errorHandler };
