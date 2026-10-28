import { useState } from "react";
import { useStore } from "../lib/store";
import { Logo } from "./ui";

const LINKS = [
  { name: "browse", label: "Find a pet", match: ["browse", "pet"] },
  { name: "scan", label: "Photo scan", match: ["scan"] },
  { name: "alerts", label: "Alerts", match: ["alerts"] },
  { name: "register", label: "Register", match: ["register"] },
  { name: "dashboard", label: "Dashboard", match: ["dashboard"] },
];

export default function Navbar() {
  const { route, navigate, currentUser, signOut, toast } = useStore();
  const [open, setOpen] = useState(false);

  const go = (name, param, query) => {
    setOpen(false);
    navigate(name, param, query);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <button onClick={() => go("home")} className="cursor-pointer" aria-label="AnimalID home">
          <Logo />
        </button>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <button
              key={l.name}
              onClick={() => go(l.name)}
              className={`cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                l.match.includes(route.name)
                  ? "bg-pine-50 text-pine-900"
                  : "text-stone-600 hover:bg-stone-100 hover:text-pine-950"
              }`}
            >
              {l.label}
            </button>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {currentUser ? (
            <>
              <button
                onClick={() => go("dashboard")}
                className="cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-stone-600 hover:text-pine-950"
              >
                Hi, {currentUser.name.split(" ")[0]}
              </button>
              <button
                onClick={() => {
                  signOut();
                  toast("Signed out. See you soon!");
                  go("home");
                }}
                className="cursor-pointer rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:border-stone-400"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => go("auth", null, { mode: "in" })}
                className="cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100"
              >
                Sign in
              </button>
              <button
                onClick={() => go("auth", null, { mode: "up" })}
                className="cursor-pointer rounded-lg bg-pine-900 px-4 py-2 text-sm font-semibold text-white hover:bg-pine-800"
              >
                Create account
              </button>
            </>
          )}
        </div>

        <button
          className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg hover:bg-stone-100 md:hidden"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5 fill-pine-950" aria-hidden="true">
            {open ? (
              <path d="M5.3 4.7 4.7 5.3 9.4 10l-4.7 4.7.6.6L10 10.6l4.7 4.7.6-.6L10.6 10l4.7-4.7-.6-.6L10 9.4z" />
            ) : (
              <path d="M2 5h16v2H2zm0 4h16v2H2zm0 4h16v2H2z" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <nav className="border-t border-stone-200 bg-white px-4 py-3 md:hidden" aria-label="Mobile">
          {[{ name: "home", label: "Home" }, ...LINKS].map((l) => (
            <button
              key={l.name}
              onClick={() => go(l.name)}
              className="block w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-stone-700 hover:bg-stone-100"
            >
              {l.label}
            </button>
          ))}
          <div className="mt-2 flex gap-2 border-t border-stone-200 pt-3">
            {currentUser ? (
              <button
                onClick={() => {
                  signOut();
                  go("home");
                }}
                className="flex-1 cursor-pointer rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-semibold"
              >
                Sign out ({currentUser.name.split(" ")[0]})
              </button>
            ) : (
              <>
                <button
                  onClick={() => go("auth", null, { mode: "in" })}
                  className="flex-1 cursor-pointer rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-semibold"
                >
                  Sign in
                </button>
                <button
                  onClick={() => go("auth", null, { mode: "up" })}
                  className="flex-1 cursor-pointer rounded-lg bg-pine-900 px-3 py-2.5 text-sm font-semibold text-white"
                >
                  Create account
                </button>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
