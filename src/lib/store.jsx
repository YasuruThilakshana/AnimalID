import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import api, { apiError, hasSession, markSessionKnown, setAuthToken } from "./api.js";
import { inferActivityKind } from "./activity.js";

const LS_ACTIVITY = "animalid.activity";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — app still works in-memory */
  }
}

const SPECIES_COLORS = {
  Dog: ["#174840", "#1f5c52"],
  Cat: ["#7c4a1e", "#b98a1f"],
  Bird: ["#1d5c7c", "#2f8fb5"],
  Rabbit: ["#6d4a7c", "#9a6fb0"],
  Reptile: ["#2f6b3a", "#5da85f"],
  Fish: ["#14566e", "#38a3c4"],
  Farm: ["#8a5a24", "#c99a4b"],
  Exotic: ["#5c2f6b", "#a06bc0"],
  Elephant: ["#3d4b5c", "#7b8aa0"],
  Other: ["#4a5568", "#718096"],
};

export function speciesGradient(species) {
  return SPECIES_COLORS[species] || SPECIES_COLORS.Other;
}

export const SPECIES_OPTIONS = ["Dog", "Cat", "Bird", "Rabbit", "Reptile", "Fish", "Farm", "Exotic", "Elephant", "Other"];

/** Parse location.hash into { name, param, query } */
export function parseHash() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [pathPart, queryPart] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ""));
  if (segments.length === 0) return { name: "home", param: null, query };
  if (segments[0] === "browse") return { name: "browse", param: null, query };
  if (segments[0] === "scan") return { name: "scan", param: null, query };
  if (segments[0] === "alerts") return { name: "alerts", param: null, query };
  if (segments[0] === "auth") return { name: "auth", param: null, query };
  if (segments[0] === "register") return { name: "register", param: null, query };
  if (segments[0] === "pet" && segments[1])
    return { name: "pet", param: decodeURIComponent(segments[1]), query };
  if (segments[0] === "dashboard") return { name: "dashboard", param: null, query };
  if (segments[0] === "messages") return { name: "messages", param: null, query };
  if (segments[0] === "why-animalid") return { name: "why", param: null, query };
  if (segments[0] === "forgot-password") return { name: "forgot-password", param: null, query };
  if (segments[0] === "reset-password")
    return {
      name: "reset-password",
      param: segments[1] ? decodeURIComponent(segments[1]) : null,
      query,
    };
  return { name: "home", param: null, query };
}

export function buildHash(name, param, query) {
  const q = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
  if (name === "home") return "#/";
  if (name === "browse") return `#/browse${q}`;
  if (name === "scan") return `#/scan${q}`;
  if (name === "alerts") return `#/alerts${q}`;
  if (name === "auth") return `#/auth${q}`;
  if (name === "register") return `#/register${q}`;
  if (name === "pet") return `#/pet/${encodeURIComponent(param || "")}${q}`;
  if (name === "dashboard") return "#/dashboard";
  if (name === "messages") return `#/messages${q}`;
  if (name === "why") return "#/why-animalid";
  if (name === "forgot-password") return `#/forgot-password${q}`;
  if (name === "reset-password") return `#/reset-password/${encodeURIComponent(param || "")}${q}`;
  return "#/";
}

/** Display identifier: auto-generated tag (TAG-001-0001) with id fallback. */
export function petDisplayId(pet) {
  return pet?.tagNumber || (pet?.id != null ? `AID-${pet.id}` : "");
}

/** Front photo URL regardless of whether it is an upload URL or data URL. */
export function petPhoto(pet, angle = "front") {
  return pet?.photos?.[angle] || (angle === "front" ? pet?.imageUrl : null) || null;
}

const StoreContext = createContext(null);

let toastSeq = 1;

export function StoreProvider({ children }) {
  const [route, setRoute] = useState(parseHash);
  const [pets, setPets] = useState([]);
  const [petsLoading, setPetsLoading] = useState(true);
  const [petsError, setPetsError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [activity, setActivity] = useState(() => read(LS_ACTIVITY, []));
  const [toasts, setToasts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [messagesUnread, setMessagesUnread] = useState(0);
  const [alertsSeenAt, setAlertsSeenAt] = useState(0);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => write(LS_ACTIVITY, activity.slice(0, 80)), [activity]);

  const navigate = useCallback((name, param, query) => {
    const hash = buildHash(name, param, query);
    if (window.location.hash === hash) {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
    } else {
      window.location.hash = hash;
    }
  }, []);

  const toast = useCallback((text, kind = "ok") => {
    const id = toastSeq++;
    setToasts((prev) => [...prev.slice(-2), { id, text, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  const logActivity = useCallback((text, email, kind) => {
    const resolvedKind = kind || inferActivityKind(text);
    setActivity((prev) =>
      [{ t: Date.now(), text, email: email || null, kind: resolvedKind }, ...prev].slice(0, 80),
    );
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!hasSession()) {
      setNotifications([]);
      return [];
    }
    try {
      const { data } = await api.get("/notifications");
      const list = Array.isArray(data.notifications) ? data.notifications : [];
      setNotifications(list);
      return list;
    } catch {
      return null; // offline — keep the last known list
    }
  }, []);

  const notificationsUnread = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const fetchMessagesUnread = useCallback(async () => {
    if (!hasSession()) {
      setMessagesUnread(0);
      return 0;
    }
    try {
      const { data } = await api.get("/messages/unread-count");
      const count = Number(data.unreadCount) || 0;
      setMessagesUnread(count);
      return count;
    } catch {
      return null; // offline — keep the last known count
    }
  }, []);

  const markNotificationsRead = useCallback(async () => {
    if (!hasSession()) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await api.post("/notifications/read-all");
    } catch {
      fetchNotifications(); // fall back to server truth
    }
  }, [fetchNotifications]);

  const alertsSeenKey = (email) => `animalid.alertsSeen.${String(email || "").toLowerCase()}`;

  // Per-user "last viewed the Alerts Hub" marker; everything reported missing
  // after it counts as unread until the next visit.
  useEffect(() => {
    if (!currentUser) {
      setAlertsSeenAt(0);
      return;
    }
    try {
      setAlertsSeenAt(Number(localStorage.getItem(alertsSeenKey(currentUser.email))) || 0);
    } catch {
      setAlertsSeenAt(0);
    }
  }, [currentUser]);

  const markAlertsSeen = useCallback(() => {
    if (!currentUser) return;
    const now = Date.now();
    setAlertsSeenAt(now);
    try {
      localStorage.setItem(alertsSeenKey(currentUser.email), String(now));
    } catch {
      /* seen marker simply won't persist */
    }
  }, [currentUser]);

  const unreadAlerts = useMemo(() => {
    if (!currentUser) return 0;
    return pets.filter((p) => {
      if (p.status !== "lost") return false;
      const entry = (p.timeline || []).filter((t) => String(t.text || "").toLowerCase().includes("lost")).pop();
      return entry && Number(entry.t) > alertsSeenAt;
    }).length;
  }, [pets, currentUser, alertsSeenAt]);

  const refreshPets = useCallback(async () => {
    setPetsLoading(true);
    setPetsError("");
    try {
      const { data } = await api.get("/animals");
      setPets(Array.isArray(data) ? data : []);
    } catch (err) {
      setPetsError(apiError(err, "Could not load animals from the server."));
    } finally {
      setPetsLoading(false);
    }
  }, []);

  // Initial load: probe the cookie session (if any) + animal registry.
  // The HTTP-only cookie is invisible to JS, so always ask /auth/me.
  useEffect(() => {
    refreshPets();
    (async () => {
      try {
        const { data } = await api.get("/auth/me");
        setCurrentUser(data.user);
        markSessionKnown(true);
        fetchNotifications();
        fetchMessagesUnread();
      } catch {
        markSessionKnown(false);
        setCurrentUser(null);
      } finally {
        setAuthReady(true);
      }
    })();
  }, [refreshPets, fetchNotifications, fetchMessagesUnread]);

  // Lightweight instant-notification polling while signed in.
  useEffect(() => {
    if (!currentUser) return undefined;
    const id = window.setInterval(() => {
      fetchNotifications();
      fetchMessagesUnread();
    }, 45000);
    return () => window.clearInterval(id);
  }, [currentUser, fetchNotifications, fetchMessagesUnread]);

  const signUp = useCallback(
    async (name, email, password) => {
      try {
        const { data } = await api.post("/auth/register", { name, email, password });
        setAuthToken(data.token);
        markSessionKnown(true);
        setCurrentUser(data.user);
        fetchNotifications();
        fetchMessagesUnread();
        logActivity(`${data.user.name} created an account`, data.user.email, "account");
        return { user: data.user };
      } catch (err) {
        return { error: apiError(err) };
      }
    },
    [logActivity, fetchNotifications, fetchMessagesUnread],
  );

  const signIn = useCallback(
    async (email, password) => {
      try {
        const { data } = await api.post("/auth/login", { email, password });
        setAuthToken(data.token);
        markSessionKnown(true);
        setCurrentUser(data.user);
        fetchNotifications();
        fetchMessagesUnread();
        logActivity(`${data.user.name} signed in`, data.user.email, "account");
        return { user: data.user };
      } catch (err) {
        return { error: apiError(err) };
      }
    },
    [logActivity, fetchNotifications, fetchMessagesUnread],
  );

  const signInDemo = useCallback(async () => {
    const email = "demo@animalid.app";
    const password = "demo1234";
    let res = await signIn(email, password);
    if (res.error) {
      res = await signUp("Demo Owner", email, password);
    }
    return res;
  }, [signIn, signUp]);

  const signOut = useCallback(async () => {
    if (currentUser?.email) logActivity("Signed out", currentUser.email);
    try {
      await api.post("/auth/logout");
    } catch {
      /* offline — still clear local state so the UI signs out */
    }
    markSessionKnown(false);
    setCurrentUser(null);
    setNotifications([]);
    setMessagesUnread(0);
  }, [currentUser, logActivity]);

  /**
   * Create or update an animal record.
   * @param {object} pet animal fields (includes `id` when updating)
   * @param {Record<string, File>} [files] new photo uploads keyed by angle
   */
  const savePet = useCallback(async (pet, files = {}) => {
    const hasFiles = Object.values(files).some(Boolean);
    if (!hasFiles) {
      const payload = { ...pet };
      delete payload.id;
      delete payload.tagNumber;
      delete payload.embedding;
      delete payload.createdAt;
      delete payload.updatedAt;
      if (pet.id) {
        const { data } = await api.put(`/animals/${pet.id}`, payload);
        setPets((prev) => prev.map((p) => (String(p.id) === String(data.id) ? data : p)));
        return data;
      }
      const { data } = await api.post("/animals", payload);
      setPets((prev) => [data, ...prev]);
      return data;
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(pet)) {
      if (value === undefined || value === null) continue;
      if (["id", "tagNumber", "embedding", "createdAt", "updatedAt"].includes(key)) continue;
      form.append(key, typeof value === "object" ? JSON.stringify(value) : value);
    }
    for (const [angle, file] of Object.entries(files)) {
      if (file) form.append(angle, file);
    }
    const { data } = pet.id
      ? await api.put(`/animals/${pet.id}`, form)
      : await api.post("/animals", form);
    setPets((prev) =>
      pet.id
        ? prev.map((p) => (String(p.id) === String(data.id) ? data : p))
        : [data, ...prev],
    );
    return data;
  }, []);

  const deletePet = useCallback(async (id) => {
    await api.delete(`/animals/${id}`);
    setPets((prev) => prev.filter((p) => String(p.id) !== String(id)));
  }, []);

  const reportSighting = useCallback(async (id, place, note) => {
    const { data } = await api.post(`/animals/${id}/sightings`, { place, note });
    setPets((prev) => prev.map((p) => (String(p.id) === String(id) ? data : p)));
    return data;
  }, []);

  /**
   * Run a photo scan against the backend. Returns
   * { match: { animal, similarity, band, reasons } | null, matches: [...],
   *   totalCompared, threshold, topN, engine } — matches are pre-filtered to
   * high-confidence candidates ranked by similarity (descending).
   */
  const scanPhoto = useCallback(async (file, hints = {}) => {
    const form = new FormData();
    form.append("photo", file);
    if (hints.species) form.append("species", hints.species);
    if (hints.markings) form.append("markings", hints.markings);
    if (hints.location) form.append("location", hints.location);
    const { data } = await api.post("/animals/scan", form);
    return data;
  }, []);

  const subscribeAlerts = useCallback(async (email, location = "") => {
    await api.post("/alerts/subscribe", { email, location });
  }, []);

  const value = useMemo(
    () => ({
      route,
      navigate,
      toasts,
      toast,
      currentUser,
      authReady,
      signUp,
      signIn,
      signInDemo,
      signOut,
      pets,
      petsLoading,
      petsError,
      refreshPets,
      savePet,
      deletePet,
      reportSighting,
      scanPhoto,
      subscribeAlerts,
      activity,
      logActivity,
      notifications,
      notificationsUnread,
      fetchNotifications,
      markNotificationsRead,
      messagesUnread,
      fetchMessagesUnread,
      unreadAlerts,
      markAlertsSeen,
    }),
    [
      route,
      navigate,
      toasts,
      toast,
      currentUser,
      authReady,
      signUp,
      signIn,
      signInDemo,
      signOut,
      pets,
      petsLoading,
      petsError,
      refreshPets,
      savePet,
      deletePet,
      reportSighting,
      scanPhoto,
      subscribeAlerts,
      activity,
      logActivity,
      notifications,
      notificationsUnread,
      fetchNotifications,
      markNotificationsRead,
      messagesUnread,
      fetchMessagesUnread,
      unreadAlerts,
      markAlertsSeen,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}

/**
 * Pick the fields the assistant endpoint accepts as pet context. The full
 * profile schema (medical history, vaccinations, allergies, medications,
 * behavioral notes, ...) travels with every chat message so Meta AI answers
 * stay personalized; the server re-validates every field.
 */
export function toAssistantAnimal(pet) {
  if (!pet) return null;
  const out = {};
  for (const key of [
    "name", "species", "breed", "age", "gender", "color", "weight",
    "location", "lostLocation", "marks", "status", "tagNumber", "diet",
    "vet", "activityLevel", "livingEnvironment",
  ]) {
    if (typeof pet[key] === "string" && pet[key].trim()) out[key] = pet[key].trim();
  }
  for (const key of ["ageYears", "weightKg"]) {
    if (pet[key] !== undefined && pet[key] !== null && pet[key] !== "" && Number.isFinite(Number(pet[key]))) {
      out[key] = Number(pet[key]);
    }
  }
  for (const key of ["spayedNeutered", "microchipped"]) {
    if (typeof pet[key] === "boolean") out[key] = pet[key];
  }
  for (const key of ["medicalHistory", "behavioralNotes", "vaccinations", "allergies", "medications"]) {
    const value = pet[key];
    if (typeof value === "string" && value.trim()) out[key] = [value.trim()];
    else if (Array.isArray(value) && value.filter((v) => typeof v === "string" && v.trim()).length) {
      out[key] = value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim());
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Open the Ask Ash chat window with an animal's context attached.
 * Scanner results and pet profiles call this so the species/category
 * travels automatically to POST /api/assistant/chat.
 */
export function openAssistant(animal = null, prompt = "") {
  window.dispatchEvent(new CustomEvent("animalid:ask-ash", { detail: { animal, prompt } }));
}

export function timeAgo(t) {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}
