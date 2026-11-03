import axios from "axios";

const LEGACY_TOKEN_KEY = "animalid.token";

// The JWT lives in an HTTP-only session cookie the browser sends
// automatically (see withCredentials below), so page JS — and any XSS
// payload — can never read it. The in-memory token below is only a fallback
// for non-browser API clients; it never touches persistent storage.
let memoryToken = null;
let sessionActive = false;

try {
  // One-time upgrade: move a pre-cookie localStorage token into memory so
  // existing sign-ins survive the migration, then delete it from storage.
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy) {
    memoryToken = legacy;
    sessionActive = true;
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
} catch {
  /* storage unavailable — cookie session still works */
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  // Send the HTTP-only session cookie on same-origin (Vite proxy) and
  // cross-origin deployments alike (server reflects origin + credentials).
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  // Bearer fallback for non-cookie clients; browsers authenticate via cookie.
  if (memoryToken) config.headers.Authorization = `Bearer ${memoryToken}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // A 401 means the session (cookie or token) is invalid — stop sending it.
    if (err?.response?.status === 401) {
      memoryToken = null;
      sessionActive = false;
    }
    return Promise.reject(err);
  },
);

export function setAuthToken(token) {
  memoryToken = token || null;
}

export function getAuthToken() {
  return memoryToken;
}

/** True when the user may hold a server session (cookie or fallback token). */
export function hasSession() {
  return sessionActive || Boolean(memoryToken);
}

export function markSessionKnown(active) {
  sessionActive = Boolean(active);
  if (!active) memoryToken = null;
}

export function apiError(err, fallback = "Something went wrong. Please try again.") {
  return err?.response?.data?.error || fallback;
}

export default api;
