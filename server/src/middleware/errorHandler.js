/**
 * Global API error boundary (Express error middleware, arity 4). Every
 * controller forwards failures here via next(err); this is what turns them
 * into safe JSON instead of stack traces or hung sockets. Pure function of
 * (err, res) apart from the log line, so it is unit-testable.
 */
// eslint-disable-next-line no-unused-vars
function apiErrorHandler(err, _req, res, _next) {
  console.error("[api]", err && err.message ? err.message : err);
  // After a proxy/client reset the headers are already sent (or the socket
  // is dead): sending again would throw ERR_HTTP_HEADERS_SENT, so delegate.
  if (res.headersSent) return _next(err);
  if (err && err.message && err.message.includes("Only image uploads")) {
    return res.status(400).json({ error: err.message });
  }
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({ error: "That upload is too large." });
  }
  res.status(500).json({ error: "Something went wrong. Please try again." });
}

module.exports = { apiErrorHandler };
