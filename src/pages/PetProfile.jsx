import { useState } from "react";
import { PetAvatar, ScanCode, StatusPill } from "../components/ui";
import { apiError } from "../lib/api.js";
import { petDisplayId, petPhoto, timeAgo, useStore } from "../lib/store";

const ANGLE_LABELS = { front: "Front", left: "Left side", right: "Right side", mark: "Mark" };

export default function PetProfile() {
  const { route, navigate, pets, savePet, deletePet, reportSighting, currentUser, toast, logActivity } = useStore();
  const pet = pets.find(
    (p) => String(p.id) === String(route.param) || p.tagNumber === route.param,
  );
  const [angle, setAngle] = useState("front");
  const [sighting, setSighting] = useState({ place: "", note: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!pet) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="font-display text-3xl font-bold text-pine-950">Pet not found</h1>
        <p className="mt-2 text-sm text-stone-600">
          That AnimalID doesn't exist or was removed. Check the ID and try again.
        </p>
        <button
          onClick={() => navigate("browse")}
          className="mt-6 cursor-pointer rounded-xl bg-pine-900 px-6 py-3 text-sm font-bold text-white hover:bg-pine-800"
        >
          Browse all pets
        </button>
      </main>
    );
  }

  const isOwner = currentUser?.email === pet.ownerEmail;
  const photoAngles = Object.keys(ANGLE_LABELS).filter((k) => petPhoto(pet, k));
  const currentPhoto = petPhoto(pet, angle);
  const displayId = petDisplayId(pet);
  const scanScore = route.query?.score;
  const scanBand = route.query?.band;

  const setStatus = async (status) => {
    const label = status === "lost" ? "Reported lost" : status === "found" ? "Listed as found" : "Marked safe at home";
    setBusy(true);
    try {
      await savePet({ ...pet, status, timeline: [...(pet.timeline || []), { t: Date.now(), text: label }] });
      logActivity(`${pet.name} was ${status === "safe" ? "marked safe" : `reported ${status}`}`, pet.ownerEmail);
      toast(status === "lost" ? `Lost alert broadcast for ${pet.name}.` : `${pet.name} marked as ${status}.`);
    } catch (err) {
      toast(apiError(err, "Could not update the status."), "warn");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deletePet(pet.id);
      logActivity(`${pet.name} (${displayId}) was removed`, currentUser.email);
      toast(`${pet.name}'s profile was deleted.`);
      navigate("dashboard");
    } catch (err) {
      toast(apiError(err, "Could not delete the profile."), "warn");
    } finally {
      setBusy(false);
    }
  };

  const submitSighting = async (e) => {
    e.preventDefault();
    if (sighting.place.trim().length < 3) return toast("Where did you see them? Add a place.", "warn");
    setBusy(true);
    try {
      await reportSighting(pet.id, sighting.place, sighting.note);
      logActivity(`Sighting of ${pet.name} at ${sighting.place.trim()}`, currentUser?.email);
      setSighting({ place: "", note: "" });
      toast("Sighting reported. The owner has been notified.");
    } catch (err) {
      toast(apiError(err, "Could not report the sighting."), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <button
        onClick={() => window.history.length > 1 ? window.history.back() : navigate("browse")}
        className="cursor-pointer text-sm font-bold text-pine-800 hover:underline"
      >
        ← Back
      </button>

      {scanScore && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-pine-950 px-5 py-4 text-white">
          <p className="text-sm font-bold">
            Photo scan match — {scanScore}% visual similarity
            {scanBand ? <span className="ml-2 rounded-md bg-amber-400 px-2 py-0.5 text-xs font-bold text-pine-950">{scanBand} confidence</span> : null}
          </p>
          <button
            onClick={() => navigate("scan")}
            className="cursor-pointer rounded-lg bg-white/15 px-4 py-2 text-sm font-bold hover:bg-white/25"
          >
            Back to scan results
          </button>
        </div>
      )}

      {pet.status === "lost" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ember-600 px-5 py-4 text-white">
          <p className="text-sm font-bold">
            ⚠ {pet.name} is missing — last seen in {pet.location}. If you spot them, report it below.
          </p>
          <a href="#sighting" className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-ember-700">
            Report a sighting
          </a>
        </div>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* Left: gallery + details */}
        <div>
          <div className="overflow-hidden rounded-3xl border border-stone-200 bg-stone-100">
            {currentPhoto ? (
              <img src={currentPhoto} alt={`${pet.name}, ${ANGLE_LABELS[angle]} view`} className="h-80 w-full object-cover sm:h-96" />
            ) : (
              <PetAvatar pet={pet} className="h-80 w-full sm:h-96" label={`${pet.name}, no ${angle} photo`} />
            )}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2" role="tablist" aria-label="Photo angles">
            {Object.keys(ANGLE_LABELS).map((a) => (
              <button
                key={a}
                role="tab"
                aria-selected={angle === a}
                onClick={() => setAngle(a)}
                className={`cursor-pointer overflow-hidden rounded-xl border-2 ${
                  angle === a ? "border-pine-900" : "border-transparent opacity-70 hover:opacity-100"
                }`}
              >
                {petPhoto(pet, a) ? (
                  <img src={petPhoto(pet, a)} alt="" className="h-16 w-full object-cover sm:h-20" />
                ) : (
                  <span className="grid h-16 w-full place-items-center bg-stone-100 text-[11px] font-bold text-stone-400 sm:h-20">
                    {ANGLE_LABELS[a]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-xs font-semibold text-stone-500">
            Viewing: {ANGLE_LABELS[angle]} · {photoAngles.length} of 4 angles uploaded
          </p>

          <div className="mt-8">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-4xl font-bold tracking-tight text-pine-950">{pet.name}</h1>
              <StatusPill status={pet.status} />
            </div>
            <p className="mt-1 text-sm font-medium text-stone-500">
              {pet.breed} · {pet.species} · {pet.gender} · {pet.age}
            </p>
          </div>

          <dl className="mt-6 grid gap-x-10 gap-y-4 rounded-2xl border border-stone-200 bg-white p-6 text-sm sm:grid-cols-2">
            {[
              ["AnimalID", displayId, true],
              ["Color", pet.color + (pet.weight ? ` · ${pet.weight}` : "")],
              ["Location", pet.location],
              ["Tag number", pet.tagNumber || displayId, true],
              ["Vet clinic", pet.vet || "Not recorded"],
              ["Owner", `${pet.ownerName} · ${pet.contact}`],
            ].map(([k, v, mono]) => (
              <div key={k}>
                <dt className="text-xs font-bold tracking-wide text-stone-400 uppercase">{k}</dt>
                <dd className={`mt-0.5 font-bold text-pine-950 ${mono ? "font-mono" : ""}`}>{v}</dd>
              </div>
            ))}
            <div className="sm:col-span-2">
              <dt className="text-xs font-bold tracking-wide text-stone-400 uppercase">
                Distinctive markings
              </dt>
              <dd className="mt-0.5 font-medium text-stone-700">{pet.marks || "None recorded."}</dd>
            </div>
          </dl>

          {/* Sightings */}
          <div className="mt-8">
            <h2 className="font-display text-2xl font-bold text-pine-950">
              Sightings ({pet.sightings?.length || 0})
            </h2>
            {(pet.sightings?.length || 0) === 0 ? (
              <p className="mt-2 text-sm text-stone-500">No sightings reported yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {pet.sightings.map((s, i) => (
                  <li key={i} className="rounded-xl border border-stone-200 bg-white p-4 text-sm">
                    <p className="font-bold text-pine-950">
                      {s.place} <span className="ml-2 font-medium text-stone-400">{timeAgo(s.t)}</span>
                    </p>
                    {s.note && <p className="mt-1 text-stone-600">{s.note}</p>}
                  </li>
                ))}
              </ul>
            )}

            <form id="sighting" onSubmit={submitSighting} className="mt-4 rounded-2xl bg-pine-50 p-5">
              <h3 className="text-sm font-bold text-pine-950">Seen {pet.name}? Report it here</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input
                  value={sighting.place}
                  onChange={(e) => setSighting({ ...sighting, place: e.target.value })}
                  placeholder="Where? e.g. Zilker Park, north trail"
                  className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm focus:border-pine-700 focus:outline-none"
                  aria-label="Sighting location"
                />
                <input
                  value={sighting.note}
                  onChange={(e) => setSighting({ ...sighting, note: e.target.value })}
                  placeholder="Details (optional)"
                  className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm focus:border-pine-700 focus:outline-none"
                  aria-label="Sighting details"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="mt-3 cursor-pointer rounded-xl bg-pine-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-pine-800 disabled:opacity-60"
              >
                Submit sighting
              </button>
            </form>
          </div>

          {/* Timeline */}
          <div className="mt-8">
            <h2 className="font-display text-2xl font-bold text-pine-950">History</h2>
            <ol className="mt-3 space-y-0 border-l-2 border-stone-200 pl-0">
              {(pet.timeline || []).slice().reverse().map((t, i) => (
                <li key={i} className="relative pb-4 pl-6 text-sm">
                  <span className="absolute top-1.5 -left-[5px] h-2 w-2 rounded-full bg-pine-700" />
                  <p className="font-semibold text-pine-950">{t.text}</p>
                  <p className="text-xs text-stone-400">{timeAgo(t.t)}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Right: ID card + management */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-bold tracking-widest text-stone-400 uppercase">
              Scannable AnimalID
            </p>
            <div className="mt-3 flex items-center gap-4">
              <ScanCode seed={displayId} className="h-24 w-24 shrink-0 rounded-lg border border-stone-200" />
              <div>
                <p className="font-mono text-lg font-bold text-pine-950">{displayId}</p>
                <button
                  onClick={() => window.print()}
                  className="mt-2 cursor-pointer rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-bold text-pine-900 hover:bg-stone-200"
                >
                  Print tag
                </button>
              </div>
            </div>
            <div className="ticket-edge my-4" />
            <p className="text-xs leading-relaxed text-stone-500">
              Finders scan this code to call or message {pet.ownerName} instantly — no app needed.
            </p>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-bold tracking-widest text-stone-400 uppercase">
              Contact owner
            </p>
            <p className="mt-2 text-sm font-bold text-pine-950">{pet.ownerName}</p>
            <p className="text-sm text-stone-600">{pet.contact}</p>
            <a
              href={`tel:${String(pet.contact || "").replace(/[^+\d]/g, "")}`}
              className="mt-3 block cursor-pointer rounded-xl bg-ember-500 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-ember-600"
            >
              Call about {pet.name}
            </a>
          </div>

          {isOwner && (
            <div className="rounded-2xl bg-pine-950 p-5 text-white">
              <p className="text-[11px] font-bold tracking-widest text-amber-400 uppercase">
                Manage this pet
              </p>
              <div className="mt-3 space-y-2">
                <button
                  onClick={() => navigate("register", null, { edit: pet.id })}
                  className="w-full cursor-pointer rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/20"
                >
                  Edit profile
                </button>
                {pet.status !== "lost" ? (
                  <button
                    onClick={() => setStatus("lost")}
                    disabled={busy}
                    className="w-full cursor-pointer rounded-xl bg-ember-500 px-4 py-2.5 text-sm font-bold hover:bg-ember-600 disabled:opacity-60"
                  >
                    Report as lost
                  </button>
                ) : (
                  <button
                    onClick={() => navigate("alerts", null, { poster: pet.id })}
                    className="w-full cursor-pointer rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-pine-950 hover:bg-amber-300"
                  >
                    Create lost poster
                  </button>
                )}
                {pet.status === "lost" && (
                  <button
                    onClick={() => setStatus("safe")}
                    disabled={busy}
                    className="w-full cursor-pointer rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-pine-950 hover:bg-emerald-400 disabled:opacity-60"
                  >
                    Mark as found / safe
                  </button>
                )}
                {pet.status !== "found" && pet.status !== "lost" && (
                  <button
                    onClick={() => setStatus("found")}
                    disabled={busy}
                    className="w-full cursor-pointer rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/20 disabled:opacity-60"
                  >
                    List as found stray
                  </button>
                )}
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="w-full cursor-pointer rounded-xl px-4 py-2.5 text-sm font-bold text-stone-400 hover:text-white"
                  >
                    Delete profile
                  </button>
                ) : (
                  <div className="rounded-xl bg-white/10 p-3 text-sm">
                    <p className="font-bold">Delete {pet.name}'s profile?</p>
                    <p className="mt-1 text-xs text-stone-300">
                      This permanently removes the profile, photos, and all records. This can't be undone.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={remove}
                        disabled={busy}
                        className="flex-1 cursor-pointer rounded-lg bg-ember-600 px-3 py-2 text-xs font-bold hover:bg-ember-500 disabled:opacity-60"
                      >
                        Yes, delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 cursor-pointer rounded-lg bg-white/15 px-3 py-2 text-xs font-bold hover:bg-white/25"
                      >
                        Keep
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
