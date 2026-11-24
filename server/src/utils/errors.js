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
  // A CSV/report stream can fail after the response has already started.
  // Trying to send a second response here throws ERR_HTTP_HEADERS_SENT and,
  // under PM2, turns one broken export into a crash loop — hand it back to
  // Express, which tears the connection down instead.
  if (res.headersSent) return next(err);

  const statusCode = err.statusCode || err.status || 500;
  if (process.env.NODE_ENV !== 'test') {
    console.error(err);
  }

  // JSON body parsing failures quote the offending input and byte offset —
  // answer with a fixed message instead of echoing the parser back.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  // Never leak internal error details; for expected errors (with a statusCode
  // and message from AppError) pass the message through.
  const isAppError = !!err.statusCode;
  const message = isAppError ? err.message : 'Internal server error';
  res.status(statusCode).json({ error: message });
}

module.exports = { AppError, notFound, errorHandler };
