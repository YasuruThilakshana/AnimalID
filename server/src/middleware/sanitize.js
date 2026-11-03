/**
 * Global input hygiene: trims surrounding whitespace and strips NUL bytes
 * from every string in the JSON body, query, and params. Credential fields
 * are left byte-identical (hashes must see exactly what the user typed).
 * Non-destructive by design — length/type rules live in validators.
 */
const SKIPPED_KEYS = new Set(["password", "newPassword", "currentPassword", "passwordHash"]);
const MAX_DEPTH = 10;

function sanitizeValue(value, depth) {
  if (typeof value === "string") {
    return value.replace(/\0/g, "").trim();
  }
  if (depth >= MAX_DEPTH || !value || typeof value !== "object" || Buffer.isBuffer(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = sanitizeValue(value[i], depth + 1);
    }
    return value;
  }
  for (const key of Object.keys(value)) {
    if (SKIPPED_KEYS.has(key)) continue;
    value[key] = sanitizeValue(value[key], depth + 1);
  }
  return value;
}

function sanitizeInputs(req, _res, next) {
  for (const source of ["body", "query", "params"]) {
    if (req[source] && typeof req[source] === "object") {
      sanitizeValue(req[source], 0);
    }
  }
  next();
}

module.exports = { sanitizeInputs, sanitizeValue };
