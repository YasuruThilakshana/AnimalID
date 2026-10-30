import { useEffect, useRef, useState } from "react";
import { PetAvatar, StatusPill } from "../components/ui";
import { apiError } from "../lib/api.js";
import { fileToDataUrl } from "../lib/matcher";
import { petDisplayId, petPhoto, SPECIES_OPTIONS, useStore } from "../lib/store";

const PHASES = [
  "Isolating the animal from the background…",
  "Extracting facial and marking features with SAM 3.1…",
  "Comparing against registered profiles…",
  "Ranking high-confidence matches…",
];

const BAND_STYLE = {
  High: "bg-pine-900 text-white",
  Medium: "bg-amber-400 text-pine-950",
  Low: "bg-stone-200 text-stone-600",
};

/** Format a 0–100 similarity score with one decimal (e.g. 92.4%). */
function formatScore(score) {
  const n = Number(score);
  return Number.isFinite(n) ? n.toFixed(1) : "0.0";
}

/** Confidence wording for a match score: "98% High Match", "65% Moderate Match". */
function confidenceLabel(score) {
  if (score >= 85) return "High Match";
  if (score >= 65) return "Moderate Match";
  if (score >= 50) return "Possible Match";
  return "Low Match";
}

async function urlToFile(url, name = "sample.jpg") {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}

export default function Scanner() {
  const { pets, navigate, logActivity, scanPhoto } = useStore();
  const [photo, setPhoto] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [species, setSpecies] = useState("Unknown");
  const [markings, setMarkings] = useState("");
  const [location, setLocation] = useState("");
  const [phase, setPhase] = useState(-1); // -1 idle, 0..3 scanning, 4 done
  const [results, setResults] = useState(null);
  const [meta, setMeta] = useState(null); // { totalCompared, staleEmbeddings, withoutEmbeddings, threshold, engine, segmentation, detectedSpecies }
  const [error, setError] = useState("");
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const pickFile = async (file) => {
    setError("");
    setResults(null);
    setMeta(null);
    setPhase(-1);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That file isn't an image. Please choose a JPG or PNG photo.");
      return;
    }
    try {
      setPhoto(await fileToDataUrl(file));
      setPhotoFile(file);
    } catch {
      setError("Could not read that image. Try another file.");
    }
  };

  const pickSample = async (pet) => {
    const url = petPhoto(pet);
    if (!url) return;
    setError("");
    setResults(null);
    setMeta(null);
    setPhase(-1);
    try {
      const file = url.startsWith("data:")
        ? new File([await (await fetch(url)).blob()], "sample.jpg", { type: "image/jpeg" })
        : await urlToFile(url);
      setPhoto(url.startsWith("data:") ? url : await fileToDataUrl(file));
      setPhotoFile(file);
      setSpecies(pet.species);
    } catch {
      setError("Could not load that sample photo. Try uploading your own.");
    }
  };

  const startScan = async () => {
    if (!photo || !photoFile) {
      setError("Upload a photo first — the scanner needs something to compare.");
      return;
    }
    setError("");
    setResults(null);
    setMeta(null);
    const stepMs = reducedMotion ? 60 : 850;
    const startedAt = Date.now();
    PHASES.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setPhase(i), i * stepMs));
    });
    try {
      const data = await scanPhoto(photoFile, { species, markings, location });
      // Backend returns high-confidence matches only, ranked by similarity.
      const ranked = (data.matches || []).map((m) => ({
        pet: m.animal,
        score: Number(m.score) || 0,
        visual: Number(m.visual ?? m.score) || 0,
        band: m.band,
        reasons: m.reasons || [],
      }));
      const scanMeta = {
        totalCompared: data.totalCompared ?? ranked.length,
        staleEmbeddings: data.staleEmbeddings ?? 0,
        withoutEmbeddings: data.withoutEmbeddings ?? 0,
        threshold: data.threshold ?? 50,
        engine: data.engine || "sam-3.1",
        segmentation: data.segmentation || null,
        detectedSpecies: data.detectedSpecies || null,
      };
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, PHASES.length * stepMs + (reducedMotion ? 0 : 400) - elapsed);
      timers.current.push(
        window.setTimeout(() => {
          setResults(ranked);
          setMeta(scanMeta);
          setPhase(4);
          logActivity(`Photo scan run (${ranked[0] ? `top match ${petDisplayId(ranked[0].pet)} at ${formatScore(ranked[0].score)}%` : "no high-confidence matches"})`, null);
        }, remaining),
      );
    } catch (err) {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setPhase(-1);
      setError(apiError(err, "The scan failed. Make sure the API server is running and try again."));
    }
  };

  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhoto(null);
    setPhotoFile(null);
    setResults(null);
    setMeta(null);
    setPhase(-1);
    setMarkings("");
    setLocation("");
    setError("");
  };

  const scanning = phase >= 0 && phase < PHASES.length;
  const top = results?.[0];
  const cutoff = meta?.threshold ?? 50;
  const valid = Boolean(top && top.score >= cutoff);
  const withPhotos = pets.filter((p) => petPhoto(p));

  const openResult = (entry) => {
    navigate("pet", entry.pet.id, {
      score: formatScore(entry.score),
      band: entry.band || "",
    });
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-xs font-bold tracking-widest text-ember-600 uppercase">
        AI identification · SAM embeddings
      </p>
      <h1 className="font-display mt-2 text-4xl font-bold tracking-tight text-pine-950">
        Photo search scanner
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-stone-600">
        Found a pet? Upload a photo and the scanner compares it against every registered
        profile, then shows the top matches ranked by visual similarity.
        No account needed.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Upload + preview */}
        <div>
          {!photo ? (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickFile(e.dataTransfer.files?.[0]);
              }}
              className={`flex min-h-72 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
                dragOver ? "border-pine-700 bg-pine-50" : "border-stone-300 bg-stone-50 hover:border-pine-700"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-12 w-12 fill-pine-800" aria-hidden="true">
                <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zm0 5.4a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8zm7-9.9h-2.6l-1.4-1.7a1 1 0 0 0-.8-.4H9.8a1 1 0 0 0-.8.4L7.6 4H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm1 13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.3l1.4-1.7h4.6L14.7 5H19a1 1 0 0 1 1 1z" />
              </svg>
              <span className="font-display text-xl font-bold text-pine-950">
                Drop a pet photo here, or click to browse
              </span>
              <span className="text-xs font-medium text-stone-500">
                JPG or PNG · clear, front-facing shots match best
              </span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </label>
          ) : (
            <div className="relative overflow-hidden rounded-3xl border border-stone-200 bg-pine-950">
              <img src={photo} alt="Uploaded pet for scanning" className="max-h-105 w-full object-contain" />
              {scanning && (
                <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                  <div className="scan-frame absolute inset-4 rounded-2xl sm:inset-6" />
                  <div className="scan-line absolute right-4 left-4 sm:right-6 sm:left-6" />
                </div>
              )}
              {!scanning && phase !== 4 && (
                <button
                  onClick={reset}
                  className="absolute top-3 right-3 cursor-pointer rounded-lg bg-black/60 px-3 py-1.5 text-xs font-bold text-white hover:bg-black/80"
                >
                  Use a different photo
                </button>
              )}
              {scanning && (
                <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/80 to-transparent p-5 pt-10">
                  <p className="text-sm font-bold text-white" role="status">
                    {PHASES[phase]}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/25">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all duration-700"
                      style={{ width: `${((phase + 1) / PHASES.length) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-xl bg-ember-50 px-4 py-3 text-sm font-semibold text-ember-700" role="alert">
              {error}
            </p>
          )}

          {!!withPhotos.length && !photo && (
            <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-bold tracking-wide text-stone-500 uppercase">
                No photo handy? Try a registered pet's photo
              </p>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {withPhotos.slice(0, 6).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pickSample(p)}
                    className="shrink-0 cursor-pointer overflow-hidden rounded-xl border border-stone-200 hover:border-pine-700"
                    title={`Scan with ${p.name}'s photo`}
                  >
                    <img src={petPhoto(p)} alt={p.name} className="h-16 w-16 object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results — top matches ranked by similarity; scores ≥ cutoff are valid */}
          {phase === 4 && results && (
            <section className="mt-6" aria-live="polite">
              {valid ? (
                <div className="rounded-2xl bg-pine-950 p-5 text-white">
                  <p className="text-xs font-bold tracking-widest text-amber-400 uppercase">
                    Top match · {formatScore(top.score)}% {confidenceLabel(top.score)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    {petPhoto(top.pet) ? (
                      <img src={petPhoto(top.pet)} alt="" className="h-16 w-16 rounded-xl object-cover" />
                    ) : (
                      <PetAvatar pet={top.pet} className="h-16 w-16 rounded-xl [&_span:first-of-type]:text-2xl" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-2xl font-bold">
                        {top.pet.name}{" "}
                        <span className="font-mono text-sm font-normal text-stone-300">{petDisplayId(top.pet)}</span>
                      </p>
                      <p className="text-sm text-stone-300">
                        {top.pet.species} · {top.pet.breed || "Breed unknown"}
                      </p>
                      <p className="text-xs text-stone-400">
                        {[top.pet.color, top.pet.location].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <button
                      onClick={() => openResult(top)}
                      className="cursor-pointer rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-pine-950 hover:bg-amber-300"
                    >
                      Open profile
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-brass-100 bg-amber-50 p-5">
                  <p className="font-display text-xl font-bold text-pine-950">
                    {meta?.detectedSpecies ? `No confident ${meta.detectedSpecies.toLowerCase()} match found` : "No confident match found"}
                  </p>
                  <p className="mt-1 text-sm text-stone-600">
                    {results.length > 0
                      ? `Top score was ${formatScore(top.score)}% — below the ${cutoff}% confident-match cutoff. Closest ${meta?.detectedSpecies ? `${meta.detectedSpecies.toLowerCase()} ` : ""}profiles are listed below.`
                      : meta && meta.totalCompared > 0
                        ? meta.detectedSpecies
                          ? `No scannable ${meta.detectedSpecies} profiles to compare against yet — other species are never mixed in.`
                          : `Compared against ${meta.totalCompared} registered ${meta.totalCompared === 1 ? "profile" : "profiles"}, but none have a scannable photo yet.`
                        : "There are no registered profiles to compare against yet."}{" "}
                    This pet may not be registered — you can list them as found.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => navigate("register")}
                      className="cursor-pointer rounded-xl bg-pine-900 px-4 py-2 text-sm font-bold text-white hover:bg-pine-800"
                    >
                      Register as found
                    </button>
                    <button
                      onClick={reset}
                      className="cursor-pointer rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-stone-700"
                    >
                      Scan another photo
                    </button>
                  </div>
                </div>
              )}

              {results.length > 0 && (
                <>
                  <h2 className="font-display mt-6 text-2xl font-bold text-pine-950">
                    {valid ? `Top matches (${results.length})` : `Closest profiles (${results.length})`}
                  </h2>
                  {meta && (
                    <>
                      <p className="mt-1 text-xs font-medium text-stone-500">
                        Compared against {meta.totalCompared} {meta.totalCompared === 1 ? "profile" : "profiles"} ·
                        top {results.length} shown · {meta.threshold}%+ is a confident match
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {meta.detectedSpecies && (
                          <span className="rounded-full bg-pine-900 px-2.5 py-1 text-[11px] font-bold text-white">
                            {meta.detectedSpecies} matches only
                          </span>
                        )}
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.segmentation?.applied ? "bg-pine-100 text-pine-900" : "bg-stone-100 text-stone-600"}`}>
                          {meta.segmentation?.applied ? "Subject isolated · background removed" : "Full-photo analysis"}
                        </span>
                        {meta.staleEmbeddings + meta.withoutEmbeddings > 0 && (
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                            {meta.staleEmbeddings + meta.withoutEmbeddings}{" "}
                            {meta.staleEmbeddings + meta.withoutEmbeddings === 1 ? "profile needs" : "profiles need"} a photo re-upload for matching
                          </span>
                        )}
                      </div>
                    </>
                  )}
                  <ul className="mt-3 space-y-3">
                    {results.map(({ pet, score, band, reasons }, i) => (
                      <li
                        key={pet.id}
                        className="flex gap-4 rounded-2xl border border-stone-200 bg-white p-4"
                      >
                        <span className="w-6 shrink-0 pt-1 text-center font-mono text-xs font-bold text-stone-400">
                          {i + 1}
                        </span>
                        {petPhoto(pet) ? (
                          <img src={petPhoto(pet)} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                        ) : (
                          <PetAvatar pet={pet} className="h-20 w-20 shrink-0 rounded-xl [&_span:first-of-type]:text-3xl" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => openResult({ pet, score, band })}
                              className="cursor-pointer font-display text-lg font-bold text-pine-950 hover:underline"
                            >
                              {pet.name}
                            </button>
                            <span className="font-mono text-xs text-stone-400">{petDisplayId(pet)}</span>
                            <StatusPill status={pet.status} />
                          </div>
                          <p className="mt-0.5 text-xs font-semibold text-stone-600">
                            {pet.species} · {pet.breed || "Breed unknown"}
                          </p>
                          <p className="truncate text-xs font-medium text-stone-500">
                            {[pet.color, pet.location].filter(Boolean).join(" · ")}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
                              <div
                                className={`h-full rounded-full ${band === "High" ? "bg-pine-800" : band === "Medium" ? "bg-amber-500" : "bg-stone-300"}`}
                                style={{ width: `${Math.min(100, score)}%` }}
                              />
                            </div>
                            <span className={`rounded-md px-2 py-0.5 text-xs font-bold whitespace-nowrap ${BAND_STYLE[band] || BAND_STYLE.Low}`}>
                              {formatScore(score)}% {confidenceLabel(score)}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {reasons.map((r) => (
                              <span key={r} className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">
                                {r}
                              </span>
                            ))}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>

        {/* Side panel: hints + how it works */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-bold tracking-wide text-pine-950 uppercase">
              Improve the match
            </h2>
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="scan-species" className="mb-1 block text-xs font-bold text-stone-500">
                  Species
                </label>
                <select
                  id="scan-species"
                  value={species}
                  onChange={(e) => setSpecies(e.target.value)}
                  className="w-full cursor-pointer rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-medium focus:border-pine-700 focus:outline-none"
                >
                  {["Unknown", ...SPECIES_OPTIONS].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-stone-400">
                  {species === "Unknown"
                    ? "Species is auto-detected from the closest visual match."
                    : `Only ${species} profiles will be compared — nothing else.`}
                </p>
              </div>
              <div>
                <label htmlFor="scan-marks" className="mb-1 block text-xs font-bold text-stone-500">
                  Visible markings
                </label>
                <textarea
                  id="scan-marks"
                  value={markings}
                  onChange={(e) => setMarkings(e.target.value)}
                  rows={2}
                  placeholder="e.g. white left paw, black coat"
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm focus:border-pine-700 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="scan-loc" className="mb-1 block text-xs font-bold text-stone-500">
                  Where was the pet found?
                </label>
                <input
                  id="scan-loc"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Austin"
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm focus:border-pine-700 focus:outline-none"
                />
              </div>
              <button
                onClick={startScan}
                disabled={scanning || !photo}
                className="w-full cursor-pointer rounded-xl bg-ember-500 px-4 py-3 text-sm font-bold text-white hover:bg-ember-600 disabled:cursor-default disabled:opacity-50"
              >
                {scanning ? "Scanning…" : phase === 4 ? "Scan again" : "Identify this pet"}
              </button>
              {phase === 4 && (
                <button
                  onClick={reset}
                  className="w-full cursor-pointer rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-bold text-stone-600"
                >
                  Start over
                </button>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-pine-50 p-5 text-sm">
            <h2 className="text-sm font-bold tracking-wide text-pine-950 uppercase">
              How matching works
            </h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-stone-600">
              <li>SAM 3.1 isolates the animal and removes the background on our secure server.</li>
              <li>Only the same species is ever compared; face and markings weigh most.</li>
              <li>Top matches are always shown; scores of 50%+ count as confident.</li>
            </ol>
          </div>
        </aside>
      </div>
    </main>
  );
}
