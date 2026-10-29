import { useEffect } from "react";
import PetCard from "../components/PetCard";
import { EmptyState, PetAvatar } from "../components/ui";
import { timeAgo, useStore } from "../lib/store";

export default function Dashboard() {
  const { currentUser, authReady, navigate, pets, activity } = useStore();

  useEffect(() => {
    if (authReady && !currentUser) navigate("auth", null, { mode: "in" });
  }, [authReady, currentUser, navigate]);

  if (!authReady || !currentUser) return null;

  const mine = pets.filter((p) => p.owner === currentUser.email);
  const lost = mine.filter((p) => p.status === "lost");
  const sightings = mine.reduce((n, p) => n + (p.sightings?.length || 0), 0);
  const myActivity = activity.filter((a) => !a.email || a.email === currentUser.email).slice(0, 6);
  const nearbyLost = pets.filter((p) => p.status === "lost" && p.owner !== currentUser.email).slice(0, 4);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-pine-950">
            {currentUser.name.split(" ")[0]}'s dashboard
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Member since {new Date(currentUser.joined).toLocaleDateString()} · {currentUser.email}
          </p>
        </div>
        <button
          onClick={() => navigate("register")}
          className="cursor-pointer rounded-xl bg-ember-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-ember-600"
        >
          + Register a pet
        </button>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [`${mine.length}`, "pets registered"],
          [`${lost.length}`, "currently lost"],
          [`${sightings}`, "sightings received"],
          [`${mine.filter((p) => Object.values(p.photos || {}).some(Boolean)).length}/${mine.length}`, "with photos"],
        ].map(([n, label]) => (
          <div key={label} className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="font-display text-3xl font-bold text-pine-950">{n}</p>
            <p className="mt-1 text-xs font-bold tracking-wide text-stone-500 uppercase">{label}</p>
          </div>
        ))}
      </div>

      {lost.length > 0 && (
        <div className="mt-4 rounded-2xl bg-ember-600 px-5 py-4 text-sm font-bold text-white">
          {lost.length} of your pet{lost.length === 1 ? " is" : "s are"} reported lost:{" "}
          {lost.map((p) => p.name).join(", ")}.{" "}
          <button onClick={() => navigate("pet", lost[0].id)} className="cursor-pointer underline">
            Manage the alert →
          </button>
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        {/* My pets */}
        <section>
          <h2 className="font-display text-2xl font-bold text-pine-950">My pets</h2>
          {mine.length ? (
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              {mine.map((p) => (
                <PetCard key={p.id} pet={p} />
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState
                title="No pets yet"
                body="Register your first pet to get a scannable AnimalID, lost-pet alerts, and a printable tag."
                action={
                  <button
                    onClick={() => navigate("register")}
                    className="cursor-pointer rounded-xl bg-pine-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-pine-800"
                  >
                    Register your first pet
                  </button>
                }
              />
            </div>
          )}
        </section>

        <aside className="space-y-6">
          {/* Activity */}
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-bold tracking-wide text-pine-950 uppercase">
              Recent activity
            </h2>
            {myActivity.length ? (
              <ul className="mt-3 space-y-3">
                {myActivity.map((a, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 text-sm">
                    <span className="font-medium text-stone-700">{a.text}</span>
                    <span className="shrink-0 text-xs text-stone-400">{timeAgo(a.t)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-stone-500">
                Nothing yet — register a pet to get started.
              </p>
            )}
          </section>

          {/* Nearby lost pets */}
          <section className="rounded-2xl bg-pine-950 p-5 text-white">
            <h2 className="text-sm font-bold tracking-wide text-amber-400 uppercase">
              Lost near you — keep an eye out
            </h2>
            {nearbyLost.length ? (
              <ul className="mt-3 space-y-2">
                {nearbyLost.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => navigate("pet", p.id)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-white/10 p-2.5 text-left hover:bg-white/15"
                    >
                      {p.photos?.front ? (
                        <img src={p.photos.front} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <PetAvatar pet={p} className="h-10 w-10 shrink-0 rounded-lg [&_span:first-of-type]:text-base" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{p.name}</span>
                        <span className="block truncate text-xs text-stone-300">{p.location}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-stone-300">No other lost pets reported right now.</p>
            )}
          </section>

          {/* Quick actions */}
          <section className="rounded-2xl border border-stone-200 bg-stone-100 p-5">
            <h2 className="text-sm font-bold tracking-wide text-pine-950 uppercase">
              Quick actions
            </h2>
            <div className="mt-3 grid gap-2">
              <button
                onClick={() => navigate("scan")}
                className="cursor-pointer rounded-xl bg-white px-4 py-2.5 text-left text-sm font-bold text-pine-900 shadow-sm hover:shadow"
              >
                Scan a photo to identify a pet →
              </button>
              <button
                onClick={() => navigate("alerts")}
                className="cursor-pointer rounded-xl bg-white px-4 py-2.5 text-left text-sm font-bold text-pine-900 shadow-sm hover:shadow"
              >
                Open alerts hub & poster maker →
              </button>
              <button
                onClick={() => navigate("browse", null, { status: "lost" })}
                className="cursor-pointer rounded-xl bg-white px-4 py-2.5 text-left text-sm font-bold text-pine-900 shadow-sm hover:shadow"
              >
                View all lost-pet alerts →
              </button>
              <button
                onClick={() => navigate("browse", null, { status: "found" })}
                className="cursor-pointer rounded-xl bg-white px-4 py-2.5 text-left text-sm font-bold text-pine-900 shadow-sm hover:shadow"
              >
                View found pets →
              </button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
