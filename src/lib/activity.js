// Pure activity-feed helpers (no React). Home and Dashboard filter through here
// so the rules stay testable with node:test and shared by old/new entries.

/** Kinds shown in the public Live recovery feed. */
export function isRecoveryActivity(entry) {
  if (!entry) return false;
  const kind =
    typeof entry.kind === "string" && entry.kind ? entry.kind : inferActivityKind(entry.text);
  return kind === "lost" || kind === "found" || kind === "sighting" || kind === "recovery";
}

/** Strict per-user check for Dashboard Recent activity. Global (null email) never matches. */
export function isUserActivity(entry, email) {
  if (!entry || typeof email !== "string" || !email) return false;
  return entry.email === email;
}

/** Classify legacy entries that predate the stored `kind` field. */
export function inferActivityKind(text) {
  const t = String(text ?? "").toLowerCase();
  if (!t) return "other";
  if (t.includes("photo scan") || t.includes("scan run")) return "scan";
  if (t.includes("sighting")) return "sighting";
  if (t.includes("reported lost") || t.includes("reported missing") || t.includes("alert location")) {
    return "lost";
  }
  if (
    t.includes("reported found") ||
    t.includes("listed as found") ||
    t.includes("marked safe") ||
    t.includes("marked as safe") ||
    t.includes("marked as found")
  ) {
    return "found";
  }
  return "other";
}

/** Newest-first recovery items for the Home hero feed. Keeps text + t for display. */
export function filterRecoveryFeed(list, limit = 3) {
  if (!Array.isArray(list)) return [];
  const out = list.filter(isRecoveryActivity);
  return typeof limit === "number" && limit >= 0 ? out.slice(0, limit) : out;
}

/** Newest-first items performed by `email` for Dashboard Recent activity. */
export function filterUserActivity(list, email, limit = 6) {
  if (!Array.isArray(list) || typeof email !== "string" || !email) return [];
  const out = list.filter((a) => isUserActivity(a, email));
  return typeof limit === "number" && limit >= 0 ? out.slice(0, limit) : out;
}
