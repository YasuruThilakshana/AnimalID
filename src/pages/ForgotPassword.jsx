import { useState } from "react";
import api, { apiError } from "../lib/api.js";
import { useStore } from "../lib/store";

const inputCls =
  "w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm focus:border-pine-700 focus:outline-none";

export default function ForgotPassword() {
  const { route, navigate } = useStore();
  const [email, setEmail] = useState(route.query.email || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [devLink, setDevLink] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return setError("Please enter a valid email address.");
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/forgot-password", { email: value });
      setSentTo(value);
      setDevLink(data.devResetLink || "");
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="bg-stone-100">
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6 lg:py-16">
        <div className="rounded-3xl border border-stone-200 bg-white p-6 sm:p-8">
          {sentTo ? (
            <div className="text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-pine-800 text-xl font-bold text-white">
                ✓
              </span>
              <h1 className="font-display mt-4 text-2xl font-bold text-pine-950">Check your inbox</h1>
              <p className="mt-2 text-sm text-stone-500">
                We sent a reset link to <span className="font-semibold text-stone-700">{sentTo}</span>.
                It expires in 15 minutes.
              </p>
              <p className="mt-2 text-sm text-stone-500">
                Nothing there? Check your spam folder, then try again.
              </p>
              {devLink && (
                <p className="mt-3 rounded-xl bg-brass-100 px-4 py-3 text-left text-xs break-all text-stone-700">
                  <span className="font-bold">Development reset link</span> (the email service is
                  unavailable in this environment):{" "}
                  <a href={devLink} className="font-semibold text-pine-700 underline">
                    {devLink}
                  </a>
                </p>
              )}
              <div className="mt-6 space-y-3">
                <button
                  onClick={() => navigate("auth", null, { mode: "in" })}
                  className="w-full cursor-pointer rounded-xl bg-ember-500 px-4 py-3 text-sm font-bold text-white hover:bg-ember-600"
                >
                  Back to sign in
                </button>
                <button
                  onClick={() => {
                    setSentTo("");
                    setDevLink("");
                    setError("");
                  }}
                  className="w-full cursor-pointer rounded-xl border border-stone-300 px-4 py-3 text-sm font-bold text-stone-600 hover:bg-stone-50"
                >
                  Use a different email
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="font-display text-2xl font-bold text-pine-950">Forgot your password?</h1>
              <p className="mt-1 text-sm text-stone-500">
                Enter your account email and we&apos;ll send you a link to reset it.
              </p>
              <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
                <div>
                  <label htmlFor="forgot-email" className="mb-1.5 block text-xs font-bold text-stone-600 uppercase">
                    Email
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={inputCls}
                    autoComplete="email"
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
                  {busy ? "Sending link…" : "Send reset link"}
                </button>
              </form>
              <p className="mt-5 text-center text-sm text-stone-500">
                Remembered it?{" "}
                <button
                  onClick={() => navigate("auth", null, { mode: "in" })}
                  className="cursor-pointer font-semibold text-pine-700 hover:underline"
                >
                  Back to sign in
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
