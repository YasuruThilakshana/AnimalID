/**
 * Contact privacy helpers. Phone numbers are masked by default everywhere
 * (profiles, sightings, notifications) so raw digits never render as plain
 * text; the Call action dials via a `tel:` link instead.
 */

/** True when the value looks like a phone number rather than an email. */
export function isPhoneLike(value) {
  const text = String(value || "");
  if (!text.trim() || text.includes("@")) return false;
  const digits = text.replace(/\D/g, "");
  return digits.length >= 7;
}

/**
 * Mask a phone number, keeping the first 2 and last 2 digits visible and
 * preserving separators: "+1 (555) 010-2030" -> "+1 (55*) ***-**30".
 * Values with 4 or fewer digits are fully masked.
 */
export function maskPhone(value) {
  const text = String(value || "");
  const digits = text.replace(/\D/g, "");
  if (!text.trim()) return "";
  if (digits.length <= 4) return text.replace(/\d/g, "*");
  let seen = 0;
  return text.replace(/\d/g, (d) => {
    seen += 1;
    if (seen <= 2 || seen > digits.length - 2) return d;
    return "*";
  });
}

/** `tel:` href for a raw phone value (digits + optional leading +). */
export function telHref(value) {
  const text = String(value || "").trim();
  const digits = text.replace(/\D/g, "");
  if (!digits) return "tel:";
  return `tel:${text.startsWith("+") ? "+" : ""}${digits}`;
}
