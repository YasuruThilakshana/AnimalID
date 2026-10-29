import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { PetAvatar, ScanCode } from "../components/ui";
import { timeAgo, useStore } from "../lib/store";

export function lostSince(pet) {
  const entry = (pet.timeline || []).filter((t) => t.text.toLowerCase().includes("lost")).pop();
  return entry ? entry.t : pet.createdAt;
}

function TearTabs({ phone }) {
  const short = phone || "1-800-555-0199";
  return (
    <div className="mt-4 flex gap-1" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 border border-dashed border-stone-400 py-1 text-center"
        >
          <span
            className="block text-[9px] leading-tight font-bold tracking-wide text-stone-600"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", margin: "0 auto" }}
          >
            LOST PET · {short}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PosterSheet({ pet, custom }) {
  const photo = pet.photos?.[custom.angle] || pet.photos?.front;
  return (
    <div id="poster-print" className="mx-auto w-full max-w-md overflow-hidden rounded-lg border-4 border-ember-600 bg-white">
      <div className="bg-ember-600 px-6 py-4 text-center">
        <p className="text-5xl font-black tracking-tight text-white">{custom.headline || "LOST"}</p>
        <p className="mt-1 text-sm font-bold tracking-widest text-amber-200 uppercase">
          {pet.species} · {pet.location}
        </p>
      </div>

      <div className="px-6 pt-5">
        {photo ? (
          <img src={photo} alt={pet.name} className="h-64 w-full rounded-md object-cover" />
        ) : (
          <PetAvatar pet={pet} className="h-64 w-full rounded-md [&_span:first-of-type]:text-7xl" />
        )}
        <p className="font-display mt-3 text-center text-4xl font-bold text-stone-900">{pet.name}</p>
        <p className="mt-1 text-center text-sm font-semibold text-stone-500">
          {pet.breed} · {pet.color} · {pet.gender} · {pet.age}
        </p>

        {custom.reward && (
          <p className="mx-auto mt-3 w-fit rounded-full bg-amber-400 px-5 py-1.5 text-lg font-black text-stone-900">
            REWARD: {custom.reward}
          </p>
        )}

        <div className="mt-4 space-y-1.5 text-sm">
          <p>
            <span className="font-black text-stone-900">LAST SEEN: </span>
            {pet.location} · {timeAgo(lostSince(pet))}
          </p>
          <p>
            <span className="font-black text-stone-900">MARKINGS: </span>
            {pet.marks || `${pet.color} coat`}
          </p>
          {custom.notes && (
            <p>
              <span className="font-black text-stone-900">NOTE: </span>
              {custom.notes}
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center gap-4 rounded-md bg-stone-100 p-3">
          <ScanCode seed={pet.id} className="h-20 w-20 shrink-0 rounded border border-stone-300" />
          <div className="text-xs font-semibold text-stone-600">
            <p className="font-mono text-base font-bold text-stone-900">{pet.id}</p>
            <p className="mt-1 leading-snug">
              Scan to open {pet.name}'s live profile and report a sighting instantly.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-md bg-pine-950 p-4 text-center">
          <p className="text-xs font-bold tracking-widest text-amber-400 uppercase">
            If seen, call or text immediately
          </p>
          <p className="mt-1 text-3xl font-black tracking-tight text-white">
            {custom.contact || pet.contact}
          </p>
          <p className="mt-1 text-xs font-semibold text-stone-300">
            Do not chase — {pet.name} may be scared. A photo helps more than pursuit.
          </p>
        </div>

        <TearTabs phone={custom.contact || pet.contact} />
        <p className="py-3 text-center text-[10px] font-semibold tracking-wide text-stone-400">
          Posted via AnimalID · 1-800-555-0199
        </p>
      </div>
    </div>
  );
}

function PosterModal({ pet, onClose }) {
  const { toast } = useStore();
  const [custom, setCustom] = useState({
    headline: "LOST",
    reward: "",
    contact: pet.contact,
    notes: "",
    angle: "front",
  });
  const set = (k, v) => setCustom((c) => ({ ...c, [k]: v }));
  const inputCls =
    "w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:border-pine-700 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-pine-950/80 p-4" role="dialog" aria-modal="true" aria-label={`Lost poster for ${pet.name}`}>
      <div className="mx-auto grid max-w-4xl gap-6 py-6 lg:grid-cols-[320px_1fr]">
        <div className="no-print h-fit rounded-2xl bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-pine-950">Poster for {pet.name}</h2>
            <button
              onClick={onClose}
              className="cursor-pointer rounded-lg px-2 py-1 text-xl leading-none text-stone-400 hover:bg-stone-100"
              aria-label="Close poster designer"
            >
              ×
            </button>
          </div>
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-stone-500" htmlFor="poster-headline">Headline</label>
              <input id="poster-headline" value={custom.headline} onChange={(e) => set("headline", e.target.value.toUpperCase().slice(0, 12))} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-stone-500" htmlFor="poster-reward">Reward (optional)</label>
              <input id="poster-reward" value={custom.reward} onChange={(e) => set("reward", e.target.value)} placeholder="$200" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-stone-500" htmlFor="poster-contact">Contact number</label>
              <input id="poster-contact" value={custom.contact} onChange={(e) => set("contact", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-stone-500" htmlFor="poster-notes">Extra note (optional)</label>
              <input id="poster-notes" value={custom.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Shy — do not chase" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-stone-500" htmlFor="poster-angle">Photo</label>
              <select id="poster-angle" value={custom.angle} onChange={(e) => set("angle", e.target.value)} className={`${inputCls} cursor-pointer`}>
                {["front", "left", "right", "mark"].map((a) => (
                  <option key={a} value={a}>
                    {a === "front" ? "Front face" : a === "left" ? "Left side" : a === "right" ? "Right side" : "Identifying mark"}
                    {pet.photos?.[a] ? "" : " (none uploaded)"}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                toast("Opening print dialog — choose Save as PDF to download.");
                window.setTimeout(() => window.print(), 350);
              }}
              className="w-full cursor-pointer rounded-xl bg-ember-500 px-4 py-3 text-sm font-bold text-white hover:bg-ember-600"
            >
              Print / Save as PDF
            </button>
            <p className="text-center text-[11px] text-stone-400">
              Only the poster sheet prints — this panel is hidden automatically.
            </p>
          </div>
        </div>
        <PosterSheet pet={pet} custom={custom} />
      </div>
    </div>
  );
}

/** Map a Firestore `alerts` doc onto the pet-card shape used below. */
function alertToPet(a) {
  return {
    id: a.petId,
    name: a.name || "Unknown pet",
    species: a.species || "Other",
    breed: a.breed || "Unknown",
    color: a.color || "",
    gender: "",
    age: "",
    location: a.location || "",
    contact: a.contact || "",
    marks: a.marks || "",
    status: "lost",
    createdAt: a.lostAt || Date.now(),
    photos: a.photo ? { front: a.photo } : {},
    sightings: [],
    timeline: [{ t: a.lostAt || Date.now(), text: "Reported lost" }],
  };
}

export default function Alerts() {
  const { pets, route, navigate, toast } = useStore();
  const q = route.query;
  const [location, setLocation] = useState(q.location || "");
  const [species, setSpecies] = useState(q.species || "Any species");
  const [recency, setRecency] = useState(q.recency || "any");
  const [keyword, setKeyword] = useState(q.q || "");
  const [email, setEmail] = useState("");
  // Live Firestore state. cloudLost === null means "not loaded / offline",
  // in which case the hub falls back to the store's pet list.
  const [cloudLost, setCloudLost] = useState(null);
  const [cloudAlerts, setCloudAlerts] = useState([]);

  useEffect(() => {
    if (!db) return;
    const unsubs = [
      onSnapshot(
        query(collection(db, "pets"), where("status", "==", "lost")),
        (snap) => setCloudLost(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => setCloudLost(null),
      ),
      onSnapshot(
        query(collection(db, "alerts"), where("status", "==", "lost")),
        (snap) => setCloudAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => setCloudAlerts([]),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const storeLost = useMemo(() => pets.filter((p) => p.status === "lost"), [pets]);

  const lost = useMemo(() => {
    const base = cloudLost ?? storeLost;
    const known = new Set(base.map((p) => p.id));
    const extras = cloudAlerts
      .filter((a) => a.petId && !known.has(a.petId))
      .map(alertToPet);
    return [...base, ...extras];
  }, [cloudLost, storeLost, cloudAlerts]);

  const subscribe = async (e) => {
    e.preventDefault();
    if (!email.includes("@")) return toast("Enter a valid email to subscribe.", "warn");
    if (db) {
      try {
        await addDoc(collection(db, "alertSubscriptions"), {
          email: email.trim().toLowerCase(),
          createdAt: serverTimestamp(),
        });
      } catch {
        return toast("Couldn't save your subscription. Please try again.", "warn");
      }
    }
    setEmail("");
    toast("Subscribed! You'll get alerts for your area.");
  };

  const results = useMemo(() => {
    const loc = (q.location || "").toLowerCase();
    const kw = (q.q || "").toLowerCase();
    const now = Date.now();
    const window_ms = q.recency === "24h" ? 864e5 : q.recency === "7d" ? 7 * 864e5 : q.recency === "30d" ? 30 * 864e5 : Infinity;
    return lost
      .filter((p) => {
        if (q.species && q.species !== "Any species" && p.species !== q.species) return false;
        if (loc && !p.location.toLowerCase().includes(loc)) return false;
        if (kw && ![p.name, p.breed, p.color, p.marks, p.id].join(" ").toLowerCase().includes(kw)) return false;
        if (now - lostSince(p) > window_ms) return false;
        return true;
      })
      .sort((a, b) => lostSince(b) - lostSince(a));
  }, [lost, q]);

  const apply = (e) => {
    e?.preventDefault();
    const query = {};
    if (keyword.trim()) query.q = keyword.trim();
    if (location.trim()) query.location = location.trim();
    if (species !== "Any species") query.species = species;
    if (recency !== "any") query.recency = recency;
    if (q.poster) query.poster = q.poster;
    navigate("alerts", null, query);
  };

  const posterPet = q.poster ? pets.find((p) => p.id === q.poster) : null;

  const openPoster = (id) => navigate("alerts", null, { ...q, poster: id });
  const closePoster = () => {
    const { poster: _drop, ...rest } = q;
    navigate("alerts", null, rest);
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-widest text-ember-600 uppercase">
            {lost.length} active alert{lost.length === 1 ? "" : "s"}
            <span className="ml-2 font-semibold normal-case text-stone-400">
              · {db ? "live from Firestore" : "demo data — add Firebase config for live alerts"}
            </span>
          </p>
          <h1 className="font-display mt-1 text-4xl font-bold tracking-tight text-pine-950">
            Missing pet alerts hub
          </h1>
          <p className="mt-2 max-w-xl text-sm text-stone-600">
            Every lost report in one place. Filter by area, open a profile to report a sighting,
            or generate a print-ready poster in one click.
          </p>
        </div>
        <button
          onClick={() => navigate("scan")}
          className="cursor-pointer rounded-xl bg-pine-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-pine-800"
        >
          Seen a stray? Scan a photo →
        </button>
      </div>

      {/* Filters */}
      <form onSubmit={apply} className="mt-6 rounded-2xl border border-stone-200 bg-stone-100 p-4">
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Name, breed, color, markings…"
            className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm focus:border-pine-700 focus:outline-none"
            aria-label="Keyword"
          />
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or area"
            className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm focus:border-pine-700 focus:outline-none"
            aria-label="Location"
          />
          <select
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            className="cursor-pointer rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium focus:border-pine-700 focus:outline-none"
            aria-label="Species"
          >
            {["Any species", "Dog", "Cat", "Bird", "Rabbit", "Other"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            value={recency}
            onChange={(e) => setRecency(e.target.value)}
            className="cursor-pointer rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium focus:border-pine-700 focus:outline-none"
            aria-label="Missing since"
          >
            <option value="any">Missing any time</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button type="submit" className="cursor-pointer rounded-xl bg-ember-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-ember-600">
            Filter alerts
          </button>
          <span className="ml-auto text-xs font-semibold text-stone-500">
            {results.length} result{results.length === 1 ? "" : "s"}
          </span>
        </div>
      </form>

      {/* Alert cards */}
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {results.map((p) => (
          <article key={p.id} className="overflow-hidden rounded-2xl border border-ember-100 bg-white shadow-sm">
            <div className="flex gap-4 p-4">
              {p.photos?.front ? (
                <img src={p.photos.front} alt={p.name} className="h-28 w-28 shrink-0 rounded-xl object-cover" />
              ) : (
                <PetAvatar pet={p} className="h-28 w-28 shrink-0 rounded-xl [&_span:first-of-type]:text-4xl" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-xl font-bold text-pine-950">{p.name}</h2>
                  <span className="rounded-full bg-ember-100 px-2 py-0.5 text-[11px] font-bold text-ember-700">
                    LOST · {timeAgo(lostSince(p))}
                  </span>
                </div>
                <p className="mt-0.5 text-xs font-medium text-stone-500">
                  {p.breed} · {p.color} · {p.location}
                </p>
                <p className="mt-1.5 line-clamp-2 text-sm text-stone-600">
                  {p.marks || "No marking details recorded."}
                </p>
                <p className="mt-1 font-mono text-[11px] font-bold text-stone-400">
                  {p.id} · {p.sightings?.length || 0} sighting(s)
                </p>
              </div>
            </div>
            <div className="flex gap-2 border-t border-stone-100 bg-stone-50 p-3">
              <button
                onClick={() => navigate("pet", p.id)}
                className="flex-1 cursor-pointer rounded-lg bg-pine-900 px-3 py-2 text-sm font-bold text-white hover:bg-pine-800"
              >
                View & report sighting
              </button>
              <button
                onClick={() => openPoster(p.id)}
                className="flex-1 cursor-pointer rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold text-stone-700 hover:border-stone-400"
              >
                Create poster
              </button>
            </div>
          </article>
        ))}
      </div>

      {!results.length && (
        <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center">
          <h3 className="font-display text-lg font-bold text-pine-950">
            {lost.length ? "No alerts match those filters" : "No active lost reports"}
          </h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">
            {lost.length
              ? "Try widening the area or time window."
              : "A quiet day for the neighborhood. Every registered pet is home safe."}
          </p>
        </div>
      )}

      {/* Alert subscription */}
      <div className="topo-pattern mt-10 flex flex-col items-start gap-4 rounded-2xl bg-pine-950 p-6 sm:flex-row sm:items-center">
        <div className="flex-1">
          <h2 className="font-display text-xl font-bold text-white">Get alerts for your area</h2>
          <p className="mt-1 text-sm text-stone-300">
            A text the moment a pet goes missing within 10 miles of you.
          </p>
        </div>
        <form className="flex w-full gap-2 sm:w-auto" onSubmit={subscribe}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-stone-400 focus:border-amber-400 focus:outline-none sm:w-64"
            aria-label="Email for area alerts"
          />
          <button type="submit" className="cursor-pointer rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-pine-950 hover:bg-amber-300">
            Alert me
          </button>
        </form>
      </div>

      {posterPet && <PosterModal pet={posterPet} onClose={closePoster} />}
    </main>
  );
}
