/**
 * Minimal cookie parsing (no dependency): populates req.cookies from the
 * Cookie header so session handling never depends on client script access.
 */
function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[name] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

function cookieParser(req, _res, next) {
  req.cookies = req.cookies || parseCookies(req.headers && req.headers.cookie);
  next();
}

module.exports = { cookieParser, parseCookies };
