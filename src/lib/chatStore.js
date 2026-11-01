/** Per-user Ask Ash chat storage.
 *
 *  Each session identity (logged-in user id/email, or "guest") gets its own
 *  localStorage key, so one user can never see another user's history.
 *  Pure functions over an injected storage object — no window dependency —
 *  so the isolation logic is unit-testable under node.
 */

export const LEGACY_CHAT_KEY = "animalid.chat";
const CHAT_KEY_PREFIX = "animalid.chat.";
const GUEST_SUFFIX = "guest";
const MAX_STORED = 40;

/** Storage key for a session identity: user object, raw id, or nothing (guest). */
export function chatKeyFor(user) {
  const id = user !== null && typeof user === "object" ? (user.id ?? user.email) : user;
  if (id === undefined || id === null || String(id).trim() === "") return CHAT_KEY_PREFIX + GUEST_SUFFIX;
  return CHAT_KEY_PREFIX + String(id).trim();
}

/** One-time purge of the pre-isolation shared chat log. Never throws. */
export function purgeLegacyChat(storage) {
  try {
    storage.removeItem(LEGACY_CHAT_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Load a message list; null when absent or unreadable. Never throws. */
export function loadChatFrom(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist a message list minus photo data URLs (quota-safe). Never throws. */
export function saveChatTo(storage, key, messages) {
  try {
    const slim = (Array.isArray(messages) ? messages : []).slice(-MAX_STORED).map((m) => {
      if (!m || !m.image) return m;
      const copy = { ...m };
      delete copy.image;
      return copy;
    });
    storage.setItem(key, JSON.stringify(slim));
    return true;
  } catch {
    return false;
  }
}

/** Remove one identity's stored history. Never throws. */
export function clearChatFor(storage, key) {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
