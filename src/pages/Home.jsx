import { useMemo, useState } from "react";
import PetCard from "../components/PetCard";
import { PetAvatar, ScanCode, StatusPill } from "../components/ui";
import { petDisplayId, petPhoto, timeAgo, useStore } from "../lib/store";

function HeroSearch() {
  const { navigate } = useStore();
  const [tab, setTab] = useState("id");
  const [q, setQ] = useState("");
  const [species, setSpecies] = useState("Any species");
  const [location, setLocation] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const query = {};
    if (tab === "id" && q.trim()) query.q = q.trim();
    if (tab === "description") {
      if (q.trim()) query.q = q.trim();
      if (species !== "Any species") query.species = species;
    }
    if (tab === "location" && location.trim()) query.location = location.trim();
    navigate("browse", null, query);
  };

  const tabs = [
    { id: "id", label: "Scan / ID" },
    { id: "description", label: "Description" },
    { id: "location", label: "Location" },
  ];

  return (
    <form onSubmit={submit} className="rounded-2xl border border-stone-200 bg-white p-2 shadow-xl shadow-pine-950/5">
      <div className="flex gap-1 rounded-xl bg-stone-100 p-1" role="tablist" aria-label="Search mode">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              tab === t.id ? "bg-white text-pine-950 shadow-sm" : "text-stone-500 hover:text-pine-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 p-2 sm:flex-row">
        {tab === "id" && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Enter AnimalID or tag — e.g. TAG-001-0001"
            className="min-w-0 flex-1 rounded-xl border border-stone-200 px-4 py-3 text-sm focus:border-pine-700 focus:outline-none"
            aria-label="Animal ID or tag number"
          />
        )}
        {tab === "description" && (
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Breed, color, markings — e.g. black cat, white paw"
              className="min-w-0 flex-1 rounded-xl border border-stone-200 px-4 py-3 text-sm focus:border-pine-700 focus:outline-none"
              aria-label="Pet description"
            />
            <select
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
              className="cursor-pointer rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm font-medium focus:border-pine-700 focus:outline-none"
              aria-label="Species"
            >
              {["Any species", "Dog", "Cat", "Bird", "Rabbit", "Other"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </>
        )}
        {tab === "location" && (
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or neighborhood — e.g. Portland, OR"
            className="min-w-0 flex-1 rounded-xl border border-stone-200 px-4 py-3 text-sm focus:border-pine-700 focus:outline-none"
            aria-label="Location"
          />
        )}
        <button
          type="submit"
          className="cursor-pointer rounded-xl bg-ember-500 px-6 py-3 text-sm font-bold whitespace-nowrap text-white hover:bg-ember-600"
        >
          Search pets
        </button>
      </div>
    </form>
  );
}

function IdCardMock({ pet }) {
  if (!pet) return null;
  const photo = petPhoto(pet);
  return (
    <div className="w-full max-w-sm rotate-2 rounded-2xl border border-white/15 bg-white p-4 text-pine-950 shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-widest text-stone-500 uppercase">AnimalID · Official tag</span>
        <StatusPill status={pet.status} />
      </div>
      <div className="mt-3 flex gap-3">
        {photo ? (
          <img src={photo} alt="" className="h-24 w-24 rounded-xl object-cover" />
        ) : (
          <PetAvatar pet={pet} className="h-24 w-24 shrink-0 rounded-xl [&_span:first-of-type]:text-3xl" />
        )}
        <div className="min-w-0">
          <p className="font-display text-2xl leading-none font-bold">{pet.name}</p>
          <p className="mt-1 truncate text-xs font-medium text-stone-500">
            {pet.breed} · {pet.color}
          </p>
          <p className="mt-1 font-mono text-sm font-bold">{petDisplayId(pet)}</p>
        </div>
        <ScanCode seed={petDisplayId(pet)} className="ml-auto h-16 w-16 shrink-0 rounded-md border border-stone-200" />
      </div>
      <div className="ticket-edge my-3" />
      <div className="flex items-center justify-between text-xs font-semibold text-stone-500">
        <span>📍 {pet.location}</span>
        <span className="text-pine-800">Scan to contact owner →</span>
      </div>
    </div>
  );
}

export default function Home() {
  const { pets, navigate, activity, currentUser } = useStore();

  const stats = useMemo(() => {
    const reunions = pets.filter((p) =>
      p.timeline?.some((t) => t.text.toLowerCase().includes("reunit")),
    ).length;
    const lostCount = pets.filter((p) => p.status === "lost").length;
    return [
      { n: pets.length.toLocaleString(), label: "pets protected" },
      { n: reunions.toLocaleString(), label: "reunions recorded" },
      { n: lostCount.toLocaleString(), label: "active lost alerts" },
      { n: "460+", label: "partner shelters" },
    ];
  }, [pets]);

  const featured = pets.slice(0, 3);
  const lostPets = pets.filter((p) => p.status === "lost");
  const foundPets = pets.filter((p) => p.status === "found");
  const tickerPet = pets.find((p) => p.status === "lost") || pets[0];

  return (
    <main>
      {/* ── Hero: asymmetric split ─────────────────────────── */}
      <section className="overflow-hidden border-b border-stone-200 bg-pine-50">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-12 pb-10 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:pt-16 lg:pb-14">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-pine-700/25 bg-white px-3 py-1.5 text-xs font-bold text-pine-800">
              <span className="relative flex h-2 w-2">
                <span className="absolute h-full w-full animate-ping rounded-full bg-ember-500 opacity-60" />
                <span className="h-2 w-2 rounded-full bg-ember-500" />
              </span>
              {lostPets.length} active lost-pet alerts right now
            </p>
            <h1 className="font-display mt-5 text-5xl leading-[1.02] font-bold tracking-tight text-pine-950 sm:text-6xl">
              Lost is temporary. <span className="text-ember-600 italic">Unidentified</span> isn't
              forever.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-stone-600">
              AnimalID gives every pet a scannable identity — four photo angles, an auto-generated
              tag number, and an owner contact anyone can reach in seconds. Register once, protect for
              life.
            </p>
            <div className="mt-7">
              <HeroSearch />
              <p className="mt-2.5 text-xs font-medium text-stone-500">
                Found a pet? Search by anything you know — or{" "}
                <button onClick={() => navigate("scan")} className="cursor-pointer font-bold text-ember-600 hover:underline">
                  scan a photo to identify them
                </button>
                . No account needed.
              </p>
            </div>
          </div>

          <div className="relative hidden flex-col items-center gap-4 lg:flex" aria-hidden="true">
            <IdCardMock pet={tickerPet} />
            <div className="w-full max-w-sm -rotate-1 rounded-2xl bg-pine-950 p-4 text-white shadow-xl">
              <p className="text-[11px] font-bold tracking-widest text-amber-400 uppercase">
                Live recovery feed
              </p>
              <ul className="mt-2 space-y-2 text-sm">
                {(activity.length
                  ? activity.slice(0, 3)
                  : [{ t: Date.now(), text: "No recent activity yet — register a pet to get started." }]
                ).map((a, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 border-b border-white/10 pb-2 last:border-0 last:pb-0">
                    <span className="leading-snug">{a.text}</span>
                    <span className="shrink-0 text-xs text-stone-400">{timeAgo(a.t)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-pine-700/15 bg-white/60">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-pine-700/10 px-4 sm:px-6 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="px-5 py-4">
                <dt className="order-2 mt-1 text-xs font-semibold text-stone-500">{s.label}</dt>
                <dd className="font-display order-1 text-2xl font-bold text-pine-950">{s.n}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── How it works: numbered timeline ────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-pine-950">
              From registration to reunion
            </h2>
            <p className="mt-2 max-w-lg text-sm text-stone-600">
              Three steps between your pet and a guaranteed way home. Most owners finish in under
              ten minutes.
            </p>
          </div>
          <button
            onClick={() => navigate("register")}
            className="cursor-pointer rounded-xl bg-pine-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-pine-800"
          >
            Register your pet
          </button>
        </div>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            {
              n: "01",
              t: "Register with four angles",
              d: "Front, both sides, and one identifying mark. Multi-angle photos make matches 4× more reliable than a single snapshot.",
            },
            {
              n: "02",
              t: "Get a scannable AnimalID",
              d: "A permanent auto-generated tag linked to photos, vet, and your contact. Print it, engrave it, or save it to your phone.",
            },
            {
              n: "03",
              t: "Anyone can reunite you",
              d: "Finders scan or search, reach you instantly, and log sightings on a live map — no account needed to help.",
            },
          ].map((s) => (
            <li key={s.n} className="relative rounded-2xl bg-stone-100 p-6">
              <span className="font-display text-5xl font-bold text-pine-700/20">{s.n}</span>
              <h3 className="font-display mt-2 text-xl font-bold text-pine-950">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Featured pets: editorial offset ────────────────── */}
      <section className="border-y border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-display text-3xl font-bold tracking-tight text-pine-950">
              Recently registered near you
            </h2>
            <button
              onClick={() => navigate("browse")}
              className="cursor-pointer text-sm font-bold text-ember-600 hover:underline"
            >
              Browse all pets →
            </button>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((p, i) => (
              <div key={p.id} className={i === 1 ? "lg:mt-8" : ""}>
                <PetCard pet={p} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Lost & found board ─────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-pine-950">
              Community lost &amp; found board
            </h2>
            <p className="mt-2 max-w-lg text-sm text-stone-600">
              Reported by owners, shelters, and good Samaritans. Recognize someone? Open their profile
              to help.
            </p>
          </div>
          <button
            onClick={() => navigate("alerts")}
            className="cursor-pointer rounded-xl bg-pine-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-pine-800"
          >
            Open alerts hub & poster maker
          </button>
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-ember-100 bg-ember-50 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-wide text-ember-700 uppercase">
                Lost — help bring them home
              </h3>
              <button
                onClick={() => navigate("browse", null, { status: "lost" })}
                className="cursor-pointer text-xs font-bold text-ember-700 hover:underline"
              >
                View all
              </button>
            </div>
            <ul className="mt-4 space-y-3">
              {lostPets.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => navigate("pet", p.id)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-white p-3 text-left shadow-sm hover:shadow"
                  >
                    {petPhoto(p) ? (
                      <img src={petPhoto(p)} alt="" className="h-12 w-12 rounded-lg object-cover" />
                    ) : (
                      <PetAvatar pet={p} className="h-12 w-12 shrink-0 rounded-lg [&_span:first-of-type]:text-xl" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-pine-950">
                        {p.name} · {p.breed}
                      </span>
                      <span className="block truncate text-xs text-stone-500">
                        Last seen: {p.location} ·{" "}
                        {p.sightings?.length ? `${p.sightings.length} sighting(s)` : "no sightings yet"}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] font-bold text-stone-400">{petDisplayId(p)}</span>
                  </button>
                </li>
              ))}
              {!lostPets.length && (
                <li className="rounded-xl bg-white p-4 text-sm text-stone-500">
                  No active lost reports. A good day for the neighborhood.
                </li>
              )}
            </ul>
          </div>

          <div className="rounded-2xl border border-brass-100 bg-amber-50 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-wide text-yellow-800 uppercase">
                Found — do you know the owner?
              </h3>
              <button
                onClick={() => navigate("browse", null, { status: "found" })}
                className="cursor-pointer text-xs font-bold text-yellow-800 hover:underline"
              >
                View all
              </button>
            </div>
            <ul className="mt-4 space-y-3">
              {foundPets.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => navigate("pet", p.id)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-white p-3 text-left shadow-sm hover:shadow"
                  >
                    {petPhoto(p) ? (
                      <img src={petPhoto(p)} alt="" className="h-12 w-12 rounded-lg object-cover" />
                    ) : (
                      <PetAvatar pet={p} className="h-12 w-12 shrink-0 rounded-lg [&_span:first-of-type]:text-xl" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-pine-950">
                        {p.name} · {p.breed}
                      </span>
                      <span className="block truncate text-xs text-stone-500">
                        Held at: {p.location} · contact {p.ownerName}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] font-bold text-stone-400">{petDisplayId(p)}</span>
                  </button>
                </li>
              ))}
              {!foundPets.length && (
                <li className="rounded-xl bg-white p-4 text-sm text-stone-500">
                  Nothing waiting to be claimed right now.
                </li>
              )}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Shelter strip + testimonial ────────────────────── */}
      <section className="border-y border-stone-200 bg-stone-100">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-pine-950">
              Shelters scan AnimalIDs at intake
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-stone-600">
              When a stray arrives with an AnimalID tag, shelters identify the owner in seconds
              instead of days. Partner organizations across 40 states scan every intake — free,
              forever.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["Harbor Paws", "Rose City Rescue", "Second Chance Austin", "Windy City Shelter"].map(
                (s) => (
                  <span
                    key={s}
                    className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-bold text-pine-900"
                  >
                    {s}
                  </span>
                ),
              )}
            </div>
          </div>
          <figure className="rounded-2xl bg-white p-6 shadow-sm">
            <blockquote className="font-display text-xl leading-snug font-medium text-pine-950">
              "Rocky slipped his leash at the lake. A jogger scanned his tag and called me before
              I'd even reached the parking lot."
            </blockquote>
            <figcaption className="mt-4 flex items-center gap-3">
              <span className="font-display grid h-10 w-10 place-items-center rounded-full bg-pine-900 text-sm font-bold text-white">
                LT
              </span>
              <span>
                <span className="block text-sm font-bold text-pine-950">Leo T.</span>
                <span className="block text-xs text-stone-500">Reunited in 26 minutes · Chicago</span>
              </span>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── CTA band ───────────────────────────────────────── */}
      <section className="topo-pattern bg-pine-950">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display max-w-xl text-3xl leading-tight font-bold text-white sm:text-4xl">
              Ten minutes today beats ten days of searching tomorrow.
            </h2>
            <p className="mt-3 max-w-md text-sm text-stone-300">
              Free for the first pet. Every paid plan funds tagging at partner shelters.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <button
              onClick={() => navigate(currentUser ? "register" : "auth", null, currentUser ? null : { mode: "up" })}
              className="cursor-pointer rounded-xl bg-amber-400 px-7 py-3.5 text-sm font-bold text-pine-950 hover:bg-amber-300"
            >
              {currentUser ? "Register a pet now" : "Create a free account"}
            </button>
            <a
              href="tel:+18005550199"
              className="rounded-xl border border-white/25 px-7 py-3.5 text-center text-sm font-bold text-white hover:bg-white/10"
            >
              Lost-pet hotline: 1-800-555-0199
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
