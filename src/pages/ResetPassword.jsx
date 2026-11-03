import { useState } from "react";
import { PasswordInput } from "../components/ui";
import api, { apiError } from "../lib/api.js";
import { useStore } from "../lib/store";

const inputCls =
  "w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm focus:border-pine-700 focus:outline-none";

function extractToken(route) {
  if (route.param) return route.param;
  if (route.query.token) return route.query.token;
  const pathMatch = window.location.pathname.match(/\/reset-password\/([^/?#]+)/);
  if (pathMatch) return decodeURIComponent(pathMatch[1]);
  return new URLSearchParams(window.location.search).get("token");
}

export default function ResetPassword() {
  const { route, navigate } = useStore();
  const [token] = useState(() => extractToken(route));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const checks = [
    { id: "length", label: "At least 8 characters", ok: password.length >= 8 },
    { id: "letter", label: "Contains a letter (a–z)", ok: /[A-Za-z]/.test(password) },
    { id: "number", label: "Contains a number (0–9)", ok: /[0-9]/.test(password) },
  ];

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!checks.every((c) => c.ok)) {
      return setError("Please choose a password that meets all the requirements below.");
    }
    if (password !== confirm) {
      return setError("The two passwords don't match.");
    }
    setBusy(true);
    try {
      await api.post(`/auth/reset-password/${encodeURIComponent(token)}`, { password });
      setDone(true);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const linkDead = /invalid|expired|missing/i.test(error);

  return (
    <main className="bg-stone-100">
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6 lg:py-16">
        <div className="rounded-3xl border border-stone-200 bg-white p-6 sm:p-8">
          {!token ? (
            <div className="text-center">
              <h1 className="font-display text-2xl font-bold text-pine-950">This link looks incomplete</h1>
              <p className="mt-2 text-sm text-stone-500">
                We couldn&apos;t find a reset token in this link. Request a fresh one and try again.
              </p>
              <button
                onClick={() => navigate("forgot-password")}
                className="mt-6 w-full cursor-pointer rounded-xl bg-ember-500 px-4 py-3 text-sm font-bold text-white hover:bg-ember-600"
              >
                Request a new link
              </button>
            </div>
          ) : done ? (
            <div className="text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-pine-800 text-xl font-bold text-white">
                ✓
              </span>
              <h1 className="font-display mt-4 text-2xl font-bold text-pine-950">Password updated</h1>
              <p className="mt-2 text-sm text-stone-500">
                Your new password is saved and securely encrypted. Sign in to continue.
              </p>
              <button
                onClick={() => navigate("auth", null, { mode: "in" })}
                className="mt-6 w-full cursor-pointer rounded-xl bg-ember-500 px-4 py-3 text-sm font-bold text-white hover:bg-ember-600"
              >
                Sign in
              </button>
            </div>
          ) : (
            <>
              <h1 className="font-display text-2xl font-bold text-pine-950">Choose a new password</h1>
              <p className="mt-1 text-sm text-stone-500">
                Pick something strong — your reset link expires 15 minutes after it was sent.
              </p>
              <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
                <div>
                  <PasswordInput
                    id="reset-pass"
                    label="New password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                  <ul className="mt-2 space-y-1" aria-live="polite">
                    {checks.map((c) => (
                      <li
                        key={c.id}
                        className={`flex items-center gap-2 text-xs font-semibold ${c.ok ? "text-pine-700" : "text-stone-400"}`}
                      >
                        <span
                          className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${
                            c.ok ? "bg-pine-800 text-white" : "bg-stone-200 text-stone-500"
                          }`}
                        >
                          {c.ok ? "✓" : "·"}
                        </span>
                        {c.label}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <label htmlFor="reset-confirm" className="mb-1.5 block text-xs font-bold text-stone-600 uppercase">
                    Confirm new password
                  </label>
                  <input
                    id="reset-confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your new password"
                    className={inputCls}
                    autoComplete="new-password"
                  />
                </div>
                {error && (
                  <p className="rounded-xl bg-ember-50 px-4 py-3 text-sm font-semibold text-ember-700" role="alert">
                    {error}{" "}
                    {linkDead && (
                      <button
                        type="button"
                        onClick={() => navigate("forgot-password")}
                        className="cursor-pointer underline hover:no-underline"
                      >
                        Request a new link
                      </button>
                    )}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full cursor-pointer rounded-xl bg-ember-500 px-4 py-3 text-sm font-bold text-white hover:bg-ember-600 disabled:cursor-default disabled:opacity-60"
                >
                  {busy ? "Updating password…" : "Update password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
