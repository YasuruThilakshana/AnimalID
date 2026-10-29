import { useEffect, useState } from "react";
import { ScanCode } from "../components/ui";
import { useStore } from "../lib/store";

export default function Auth() {
  const { route, navigate, signUp, signIn, signInDemo, currentUser, authReady, toast } = useStore();
  const [mode, setMode] = useState(route.query.mode === "in" ? "in" : "up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authReady && currentUser) navigate("dashboard");
  }, [authReady, currentUser, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (mode === "up" && name.trim().length < 2) return setError("Please enter your full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return setError("Please enter a valid email address.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");

    setBusy(true);
    const res = mode === "up" ? await signUp(name, email, password) : await signIn(email, password);
    setBusy(false);
    if (res.error) return setError(res.error);
    toast(mode === "up" ? `Welcome to AnimalID, ${res.user.name.split(" ")[0]}!` : `Welcome back, ${res.user.name.split(" ")[0]}!`);
    navigate(route.query.next === "register" ? "register" : "dashboard");
  };

  const useDemo = async () => {
    setBusy(true);
    const res = await signInDemo();
    setBusy(false);
    if (res.error) return setError(res.error);
    toast("Signed in with the demo account.");
    navigate("dashboard");
  };

  const inputCls =
    "w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm focus:border-pine-700 focus:outline-none";

  return (
    <main className="bg-stone-100">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:py-16">
        {/* Left: pitch panel */}
        <div className="topo-pattern hidden flex-col justify-between rounded-3xl bg-pine-950 p-8 text-white lg:flex">
          <div>
            <p className="text-xs font-bold tracking-widest text-amber-400 uppercase">
              Join 12,800+ pet owners
            </p>
            <h1 className="font-display mt-3 text-4xl leading-tight font-bold">
              Your pet's way home starts with an account.
            </h1>
            <ul className="mt-6 space-y-4 text-sm">
              {[
                ["Register unlimited pets", "IDs, photos, tags, and vet records in one place."],
                ["Instant lost-pet alerts", "Broadcast to nearby members the second one goes missing."],
                ["Scannable recovery tags", "Anyone with a phone can reach you — no app needed."],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ember-500 text-xs font-bold">
                    ✓
                  </span>
                  <span>
                    <span className="block font-bold">{t}</span>
                    <span className="block text-stone-300">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-8 flex items-center gap-4 rounded-2xl bg-white/10 p-4">
            <ScanCode seed="AID-DEMO" className="h-16 w-16 shrink-0 rounded-lg" />
            <p className="text-xs leading-relaxed text-stone-200">
              Every registration includes a printable scan code for collars, crates, and carriers.
              Try the demo account to see a finished profile.
            </p>
          </div>
        </div>

        {/* Right: form card */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 sm:p-8">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1" role="tablist" aria-label="Sign in or create account">
            {[
              { id: "up", label: "Create account" },
              { id: "in", label: "Sign in" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={mode === t.id}
                onClick={() => {
                  setMode(t.id);
                  setError("");
                }}
                className={`cursor-pointer rounded-lg px-3 py-2.5 text-sm font-bold transition-colors ${
                  mode === t.id ? "bg-white text-pine-950 shadow-sm" : "text-stone-500"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <h2 className="font-display mt-6 text-2xl font-bold text-pine-950">
            {mode === "up" ? "Create your account" : "Welcome back"}
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            {mode === "up"
              ? "Free for your first pet. No credit card required."
              : "Sign in to manage your pets and alerts."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {mode === "up" && (
              <div>
                <label htmlFor="auth-name" className="mb-1.5 block text-xs font-bold text-stone-600 uppercase">
                  Full name
                </label>
                <input
                  id="auth-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jordan Rivera"
                  className={inputCls}
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <label htmlFor="auth-email" className="mb-1.5 block text-xs font-bold text-stone-600 uppercase">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputCls}
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="auth-pass" className="mb-1.5 block text-xs font-bold text-stone-600 uppercase">
                Password
              </label>
              <input
                id="auth-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "up" ? "At least 6 characters" : "Your password"}
                className={inputCls}
                autoComplete={mode === "up" ? "new-password" : "current-password"}
              />
            </div>

            {error && (
              <p className="rounded-xl bg-ember-50 px-4 py-3 text-sm font-semibold text-ember-700" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full cursor-pointer rounded-xl bg-ember-500 px-4 py-3 text-sm font-bold text-white hover:bg-ember-600 disabled:cursor-default disabled:opacity-60"
            >
              {busy
                ? mode === "up"
                  ? "Creating account…"
                  : "Signing in…"
                : mode === "up"
                  ? "Create free account"
                  : "Sign in"}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs font-semibold text-stone-400">
            <span className="h-px flex-1 bg-stone-200" /> or <span className="h-px flex-1 bg-stone-200" />
          </div>

          <button
            onClick={useDemo}
            disabled={busy}
            className="w-full cursor-pointer rounded-xl border border-pine-700/30 bg-pine-50 px-4 py-3 text-sm font-bold text-pine-900 hover:bg-pine-100 disabled:opacity-60"
          >
            Explore with a demo account
          </button>
          <p className="mt-3 text-center text-xs text-stone-400">
            Demo signs you in instantly so you can register pets right away.
          </p>
        </div>
      </div>
    </main>
  );
}
