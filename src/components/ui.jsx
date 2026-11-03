import { useState } from "react";
import { isPhoneLike, maskPhone, telHref } from "../lib/contact.js";
import { speciesGradient } from "../lib/store";

export function Logo({ dark = false }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-pine-900">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-amber-400" aria-hidden="true">
          <circle cx="7.2" cy="9.4" r="2.1" />
          <circle cx="12" cy="7.4" r="2.1" />
          <circle cx="16.8" cy="9.4" r="2.1" />
          <path d="M12 11.6c-3.1 0-5.6 2.3-5.6 4.7 0 1.5 1.1 2.5 2.7 2.5 1 0 1.9-.4 2.9-.4s1.9.4 2.9.4c1.6 0 2.7-1 2.7-2.5 0-2.4-2.5-4.7-5.6-4.7z" />
        </svg>
      </span>
      <span className={`font-display text-xl font-bold tracking-tight ${dark ? "text-white" : "text-pine-950"}`}>
        Animal<span className="text-ember-500">ID</span>
      </span>
    </span>
  );
}

const STATUS_STYLE = {
  safe: "bg-pine-100 text-pine-900",
  lost: "bg-ember-100 text-ember-700",
  found: "bg-brass-100 text-yellow-900",
};

export function StatusPill({ status }) {
  const label = status === "safe" ? "Safe at home" : status === "lost" ? "Lost" : "Found — needs owner";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status] || STATUS_STYLE.safe}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

/** Deterministic SVG portrait used when a pet has no uploaded photo. */
export function PetAvatar({ pet, className = "", label = null }) {
  const [c1, c2] = speciesGradient(pet.species);
  const initial = (pet.name || "?").charAt(0).toUpperCase();
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
      role="img"
      aria-label={label || `${pet.name} portrait placeholder`}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full opacity-15" aria-hidden="true">
        <circle cx="78" cy="18" r="26" fill="none" stroke="white" strokeWidth="2" />
        <circle cx="88" cy="78" r="34" fill="none" stroke="white" strokeWidth="2" />
        <circle cx="12" cy="86" r="18" fill="none" stroke="white" strokeWidth="2" />
      </svg>
      <span className="font-display text-5xl font-bold text-white/95">{initial}</span>
      <span className="absolute bottom-2 left-2 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
        {pet.species}
      </span>
    </div>
  );
}

/** Fake deterministic scan-code (decorative stand-in for a QR code). */
export function ScanCode({ seed, className = "h-20 w-20" }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const cells = [];
  const n = 9;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const corner = (x < 3 && y < 3) || (x > 5 && y < 3) || (x < 3 && y > 5);
      if (corner) continue;
      h = (h * 1103515245 + 12345) >>> 0;
      if (h % 10 < 4) cells.push(`${x},${y}`);
    }
  }
  const finder = (ox, oy) => (
    <g key={`${ox}-${oy}`}>
      <rect x={ox} y={oy} width="3" height="3" fill="#0a2320" />
      <rect x={ox + 0.7} y={oy + 0.7} width="1.6" height="1.6" fill="white" />
      <rect x={ox + 1.1} y={oy + 1.1} width="0.8" height="0.8" fill="#0a2320" />
    </g>
  );
  return (
    <svg viewBox="-0.5 -0.5 10 10" className={className} role="img" aria-label={`Scan code for ${seed}`}>
      <rect x="-0.5" y="-0.5" width="10" height="10" fill="white" />
      {cells.map((c) => {
        const [x, y] = c.split(",").map(Number);
        return <rect key={c} x={x} y={y} width="0.92" height="0.92" fill="#0a2320" />;
      })}
      {finder(0, 0)}
      {finder(6, 0)}
      {finder(0, 6)}
    </svg>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center">
      <svg viewBox="0 0 24 24" className="mx-auto h-10 w-10 fill-stone-300" aria-hidden="true">
        <circle cx="7.2" cy="9.4" r="2.1" />
        <circle cx="12" cy="7.4" r="2.1" />
        <circle cx="16.8" cy="9.4" r="2.1" />
        <path d="M12 11.6c-3.1 0-5.6 2.3-5.6 4.7 0 1.5 1.1 2.5 2.7 2.5 1 0 1.9-.4 2.9-.4s1.9.4 2.9.4c1.6 0 2.7-1 2.7-2.5 0-2.4-2.5-4.7-5.6-4.7z" />
      </svg>
      <h3 className="font-display mt-3 text-lg font-bold text-pine-950">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M10.733 5.076a10.74 10.74 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.972 2.999" />
      <path d="M10.71 5.091A10.7 10.7 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.672 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

/**
 * Privacy-safe phone display: masked digits by default, a Call action that
 * dials via the native `tel:` handler, and an optional reveal toggle for
 * verified (signed-in) viewers. Raw digits never render as plain text.
 * Non-phone values (emails, blanks) render untouched.
 */
export function MaskedContact({
  value,
  showCall = true,
  revealable = true,
  className = "",
  callClassName = "cursor-pointer text-xs font-bold text-pine-700 hover:underline",
}) {
  const [revealed, setRevealed] = useState(false);
  const text = String(value || "");
  if (!text) return null;
  if (!isPhoneLike(text)) return <span className={className}>{text}</span>;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 ${className}`}>
      <span className="font-mono font-bold tracking-wide" aria-label={revealed ? "Phone number" : "Masked phone number"}>
        {revealed ? text : maskPhone(text)}
      </span>
      {revealable && (
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="cursor-pointer rounded p-0.5 text-stone-500 hover:bg-stone-100 hover:text-pine-900"
          aria-label={revealed ? "Hide phone number" : "Show phone number"}
          aria-pressed={revealed}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      )}
      {showCall && (
        <a href={telHref(text)} className={callClassName}>
          Call
        </a>
      )}
    </span>
  );
}

/** Password field with an inline show/hide toggle button. */
export function PasswordInput({ id, label, value, onChange, placeholder, autoComplete }) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-bold text-stone-600 uppercase">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 pr-11 text-sm focus:border-pine-700 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? "Hide password" : "Show password"}
          aria-pressed={showPassword}
          title={showPassword ? "Hide password" : "Show password"}
          className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-stone-400 hover:text-pine-700"
        >
          {showPassword ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}
