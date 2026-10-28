import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const LS_USERS = "animalid.users";
const LS_SESSION = "animalid.session";
const LS_PETS = "animalid.pets";
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
  Other: ["#4a5568", "#718096"],
};

export function speciesGradient(species) {
  return SPECIES_COLORS[species] || SPECIES_COLORS.Other;
}

function seedPets() {
  const now = Date.now();
  const day = 86_400_000;
  return [
    {
      id: "AID-10482",
      name: "Maple",
      species: "Dog",
      breed: "Golden Retriever",
      age: "3 years",
      gender: "Female",
      color: "Golden",
      weight: "28 kg",
      microchip: "985141042118203",
      tagId: "TAG-MPL-88",
      marks: "Small white patch on chest, freckle on nose",
      location: "Portland, OR",
      status: "safe",
      owner: "demo@animalid.app",
      ownerName: "Demo Owner",
      contact: "(503) 555-0182",
      vet: "Rose City Vet Clinic",
      createdAt: now - 210 * day,
      photos: {},
      sightings: [],
      timeline: [
        { t: now - 210 * day, text: "Registered on AnimalID" },
        { t: now - 40 * day, text: "Annual details verified" },
      ],
    },
    {
      id: "AID-22031",
      name: "Pepper",
      species: "Cat",
      breed: "Domestic Shorthair",
      age: "2 years",
      gender: "Male",
      color: "Black",
      weight: "4.5 kg",
      microchip: "985141077665431",
      tagId: "TAG-PPR-14",
      marks: "White left paw, notch on right ear",
      location: "Austin, TX",
      status: "lost",
      owner: "demo@animalid.app",
      ownerName: "Demo Owner",
      contact: "(512) 555-0119",
      vet: "South Congress Animal Care",
      createdAt: now - 150 * day,
      photos: {},
      sightings: [
        {
          t: now - 1 * day,
          place: "Zilker Park, near the big oak",
          note: "Black cat with white paw seen near picnic tables.",
        },
      ],
      timeline: [
        { t: now - 150 * day, text: "Registered on AnimalID" },
        { t: now - 3 * day, text: "Reported lost near Zilker Park" },
      ],
    },
    {
      id: "AID-31877",
      name: "Kiwi",
      species: "Bird",
      breed: "Green-cheeked Conure",
      age: "1 year",
      gender: "Female",
      color: "Green / red tail",
      weight: "70 g",
      microchip: "",
      tagId: "TAG-KWI-02",
      marks: "Leg band #4521, red tail feathers",
      location: "Seattle, WA",
      status: "safe",
      owner: "maya@example.com",
      ownerName: "Maya R.",
      contact: "(206) 555-0147",
      vet: "Avian & Exotic Clinic",
      createdAt: now - 90 * day,
      photos: {},
      sightings: [],
      timeline: [{ t: now - 90 * day, text: "Registered on AnimalID" }],
    },
    {
      id: "AID-44120",
      name: "Biscuit",
      species: "Rabbit",
      breed: "Holland Lop",
      age: "8 months",
      gender: "Male",
      color: "Cream",
      weight: "1.8 kg",
      microchip: "",
      tagId: "TAG-BSC-77",
      marks: "Floppy left ear, grey spot on back",
      location: "Denver, CO",
      status: "found",
      owner: "shelter@harborpaws.org",
      ownerName: "Harbor Paws Shelter",
      contact: "(303) 555-0160",
      vet: "Harbor Paws vet team",
      createdAt: now - 12 * day,
      photos: {},
      sightings: [],
      timeline: [
        { t: now - 12 * day, text: "Found near Cheesman Park, listed for owner claim" },
      ],
    },
    {
      id: "AID-55209",
      name: "Rocky",
      species: "Dog",
      breed: "French Bulldog",
      age: "4 years",
      gender: "Male",
      color: "Brindle",
      weight: "12 kg",
      microchip: "985141033456789",
      tagId: "TAG-RKY-31",
      marks: "Underbite, scar above left eye",
      location: "Chicago, IL",
      status: "safe",
      owner: "leo@example.com",
      ownerName: "Leo T.",
      contact: "(312) 555-0133",
      vet: "Wicker Park Vets",
      createdAt: now - 300 * day,
      photos: {},
      sightings: [],
      timeline: [
        { t: now - 300 * day, text: "Registered on AnimalID" },
        { t: now - 200 * day, text: "Reunited after 2 days (2025)" },
      ],
    },
    {
      id: "AID-66140",
      name: "Willow",
      species: "Cat",
      breed: "Siamese",
      age: "5 years",
      gender: "Female",
      color: "Seal point",
      weight: "3.8 kg",
      microchip: "985141099887766",
      tagId: "TAG-WLW-09",
      marks: "Blue eyes, kink at tip of tail",
      location: "Portland, OR",
      status: "lost",
      owner: "priya@example.com",
      ownerName: "Priya S.",
      contact: "(503) 555-0171",
      vet: "Rose City Vet Clinic",
      createdAt: now - 400 * day,
      photos: {},
      sightings: [],
      timeline: [
        { t: now - 400 * day, text: "Registered on AnimalID" },
        { t: now - 2 * day, text: "Reported lost in Laurelhurst" },
      ],
    },
  ];
}

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
  if (name === "pet") return `#/pet/${encodeURIComponent(param || "")}`;
  if (name === "dashboard") return "#/dashboard";
  return "#/";
}

const StoreContext = createContext(null);

let toastSeq = 1;

export function StoreProvider({ children }) {
  const [route, setRoute] = useState(parseHash);
  const [users, setUsers] = useState(() => read(LS_USERS, []));
  const [session, setSession] = useState(() => read(LS_SESSION, null));
  const [pets, setPets] = useState(() => {
    const existing = read(LS_PETS, null);
    if (existing && Array.isArray(existing) && existing.length) return existing;
    const seed = seedPets();
    write(LS_PETS, seed);
    return seed;
  });
  const [activity, setActivity] = useState(() => read(LS_ACTIVITY, []));
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => write(LS_USERS, users), [users]);
  useEffect(() => write(LS_PETS, pets), [pets]);
  useEffect(() => write(LS_ACTIVITY, activity.slice(0, 80)), [activity]);
  useEffect(() => write(LS_SESSION, session), [session]);

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

  const logActivity = useCallback((text, email) => {
    setActivity((prev) => [{ t: Date.now(), text, email: email || null }, ...prev].slice(0, 80));
  }, []);

  const currentUser = useMemo(
    () => users.find((u) => u.email === session?.email) || null,
    [users, session],
  );

  const signUp = useCallback(
    (name, email, password) => {
      email = email.trim().toLowerCase();
      if (users.some((u) => u.email === email)) return { error: "An account with this email already exists." };
      const user = { name: name.trim(), email, pass: btoa(password), joined: Date.now() };
      setUsers((prev) => [...prev, user]);
      setSession({ email });
      logActivity(`${user.name} created an account`, email);
      return { user };
    },
    [users, logActivity],
  );

  const signIn = useCallback(
    (email, password) => {
      email = email.trim().toLowerCase();
      const user = users.find((u) => u.email === email);
      if (!user || user.pass !== btoa(password)) return { error: "Incorrect email or password." };
      setSession({ email });
      logActivity(`${user.name} signed in`, email);
      return { user };
    },
    [users, logActivity],
  );

  const signInDemo = useCallback(() => {
    const email = "demo@animalid.app";
    setUsers((prev) =>
      prev.some((u) => u.email === email)
        ? prev
        : [...prev, { name: "Demo Owner", email, pass: btoa("demo1234"), joined: Date.now() }],
    );
    setSession({ email });
    logActivity("Demo Owner signed in", email);
  }, [logActivity]);

  const signOut = useCallback(() => setSession(null), []);

  const nextId = useCallback(() => {
    const nums = pets.map((p) => Number(String(p.id).replace(/\D/g, "")) || 0);
    const n = Math.max(66000, ...nums) + Math.floor(Math.random() * 40 + 7);
    return `AID-${n}`;
  }, [pets]);

  const savePet = useCallback(
    (pet) => {
      setPets((prev) => {
        const i = prev.findIndex((p) => p.id === pet.id);
        if (i >= 0) {
          const copy = [...prev];
          copy[i] = pet;
          return copy;
        }
        return [pet, ...prev];
      });
    },
    [setPets],
  );

  const deletePet = useCallback((id) => {
    setPets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      route,
      navigate,
      toasts,
      toast,
      users,
      currentUser,
      signUp,
      signIn,
      signInDemo,
      signOut,
      pets,
      savePet,
      deletePet,
      nextId,
      activity,
      logActivity,
    }),
    [
      route,
      navigate,
      toasts,
      toast,
      users,
      currentUser,
      signUp,
      signIn,
      signInDemo,
      signOut,
      pets,
      savePet,
      deletePet,
      nextId,
      activity,
      logActivity,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
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
