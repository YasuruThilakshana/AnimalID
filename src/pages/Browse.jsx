import { useMemo, useState } from "react";
import PetCard from "../components/PetCard";
import { EmptyState } from "../components/ui";
import { SPECIES_OPTIONS, useStore } from "../lib/store";

export default function Browse() {
  const { pets, petsLoading, petsError, refreshPets, route, navigate } = useStore();
  const [q, setQ] = useState(route.query.q || "");
  const [species, setSpecies] = useState(route.query.species || "Any species");
  const [status, setStatus] = useState(route.query.status || "any");
  const [location, setLocation] = useState(route.query.location || "");

  const results = useMemo(() => {
    const needle = (route.query.q || "").toLowerCase();
    const loc = (route.query.location || "").toLowerCase();
    const sp = route.query.species;
    const st = route.query.status;
    return pets.filter((p) => {
      if (sp && p.species !== sp) return false;
      if (st && st !== "any" && p.status !== st) return false;
      if (loc && !p.location.toLowerCase().includes(loc)) return false;
      if (!needle) return true;
      const hay = [p.id, p.tagNumber, p.name, p.breed, p.color, p.marks, p.location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return needle.split(/\s+/).every((w) => hay.includes(w));
    });
  }, [pets, route.query]);

  const apply = (e) => {
    e.preventDefault();
    const query = {};
    if (q.trim()) query.q = q.trim();
    if (species !== "Any species") query.species = species;
    if (status !== "any") query.status = status;
    if (location.trim()) query.location = location.trim();
    navigate("browse", null, query);
  };

  const clear = () => {
    setQ("");
    setSpecies("Any species");
    setStatus("any");
    setLocation("");
    navigate("browse");
  };

  const hasFilter = Object.keys(route.query).length > 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl font-bold tracking-tight text-pine-950">Find a pet</h1>
      <p className="mt-2 max-w-xl text-sm text-stone-600">
        Search every registered animal by ID, tag, description, or location. No account
        needed — helping is open to everyone.
      </p>

      <form onSubmit={apply} className="mt-6 rounded-2xl border border-stone-200 bg-stone-100 p-4">
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ID, breed, color, markings, tag…"
            className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm focus:border-pine-700 focus:outline-none"
            aria-label="Search keywords"
          />
          <select
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            className="cursor-pointer rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium focus:border-pine-700 focus:outline-none"
            aria-label="Species"
          >
            {["Any species", ...SPECIES_OPTIONS].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="cursor-pointer rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium focus:border-pine-700 focus:outline-none"
            aria-label="Status"
          >
            <option value="any">Any status</option>
            <option value="lost">Lost</option>
            <option value="found">Found</option>
            <option value="safe">Safe at home</option>
          </select>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or area"
            className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm focus:border-pine-700 focus:outline-none"
            aria-label="Location"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="cursor-pointer rounded-xl bg-pine-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-pine-800"
          >
            Search
          </button>
          {hasFilter && (
            <button
              type="button"
              onClick={clear}
              className="cursor-pointer rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 hover:border-stone-400"
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs font-semibold text-stone-500">
            {results.length} result{results.length === 1 ? "" : "s"}
          </span>
        </div>
      </form>

      {petsLoading && (
        <p className="mt-8 rounded-2xl bg-stone-100 px-6 py-6 text-center text-sm font-semibold text-stone-500" role="status">
          Loading registered pets from the database…
        </p>
      )}
      {!petsLoading && petsError && (
        <div className="mt-8 rounded-2xl border border-ember-100 bg-ember-50 px-6 py-6 text-center">
          <p className="text-sm font-semibold text-ember-700">{petsError}</p>
          <button
            onClick={refreshPets}
            className="mt-3 cursor-pointer rounded-xl bg-pine-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-pine-800"
          >
            Try again
          </button>
        </div>
      )}

      <div className="mt-8">
        {results.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((p) => (
              <PetCard key={p.id} pet={p} />
            ))}
          </div>
        ) : !petsLoading && !petsError ? (
          <EmptyState
            title="No pets match that search"
            body="Try fewer keywords, check the spelling of the ID, or widen the location. IDs look like TAG-001-0001."
            action={
              <button
                onClick={clear}
                className="cursor-pointer rounded-xl bg-pine-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-pine-800"
              >
                Show all pets
              </button>
            }
          />
        ) : null}
      </div>
    </main>
  );
}
