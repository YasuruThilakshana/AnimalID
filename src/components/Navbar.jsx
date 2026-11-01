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

function formatNotifDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function Navbar() {
  const {
    route,
    navigate,
    currentUser,
    signOut,
    toast,
    unreadAlerts,
    notifications,
    notificationsUnread,
    fetchNotifications,
    markNotificationsRead,
  } = useStore();
  const [open, setOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const go = (name, param, query) => {
    setOpen(false);
    setBellOpen(false);
    navigate(name, param, query);
  };

  const toggleBell = async () => {
    if (bellOpen) {
      setBellOpen(false);
      return;
    }
    setBellOpen(true);
    await fetchNotifications();
    await markNotificationsRead();
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
              {l.name === "alerts" && currentUser && unreadAlerts > 0 && (
                <span className="ml-1.5 rounded-full bg-ember-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                  {unreadAlerts > 9 ? "9+" : unreadAlerts}
                </span>
              )}
            </button>
          ))}
        </nav>

        {currentUser && (
          <div className="relative ml-auto md:ml-0">
            <button
              onClick={toggleBell}
              className="relative grid h-10 w-10 cursor-pointer place-items-center rounded-lg text-stone-700 hover:bg-stone-100"
              aria-label={notificationsUnread > 0 ? `${notificationsUnread} unread notifications` : "Notifications"}
              aria-expanded={bellOpen}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                <path d="M12 2a6 6 0 0 0-6 6v4l-1.7 3.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12V8a6 6 0 0 0-6-6zm0 20a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22z" />
              </svg>
              {notificationsUnread > 0 && (
                <span className="absolute top-0.5 right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-ember-500 px-1 text-[10px] font-black text-white">
                  {notificationsUnread > 9 ? "9+" : notificationsUnread}
                </span>
              )}
            </button>
            {bellOpen && (
              <>
                <button
                  aria-hidden="true"
                  tabIndex={-1}
                  onClick={() => setBellOpen(false)}
                  className="fixed inset-0 z-40 cursor-default bg-transparent"
                />
                <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
                    <p className="text-sm font-bold text-pine-950">Notifications</p>
                    <button
                      onClick={() => setBellOpen(false)}
                      className="cursor-pointer rounded-md px-1.5 py-0.5 text-lg leading-none text-stone-400 hover:bg-stone-100"
                      aria-label="Close notifications"
                    >
                      ×
                    </button>
                  </div>
                  {notifications.length ? (
                    <ul className="max-h-80 overflow-y-auto">
                      {notifications.map((n) => (
                        <li key={n.id} className={`border-b border-stone-100 px-4 py-3 last:border-0 ${n.read ? "" : "bg-amber-50/70"}`}>
                          <p className="text-xs font-bold text-pine-950">{n.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-stone-600">{n.message}</p>
                          <div className="mt-1.5 flex items-center justify-between">
                            <span className="text-[10px] font-semibold text-stone-400">{formatNotifDate(n.createdAt)}</span>
                            {n.petId && (
                              <button
                                onClick={() => go("pet", n.petId)}
                                className="cursor-pointer text-[11px] font-bold text-pine-700 hover:underline"
                              >
                                View pet →
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-6 text-center text-xs font-medium text-stone-500">
                      No notifications yet — we'll ping you the instant a scan matches your missing pet.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

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
                onClick={async () => {
                  await signOut();
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
              {l.name === "alerts" && currentUser && unreadAlerts > 0 && (
                <span className="ml-1.5 rounded-full bg-ember-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                  {unreadAlerts > 9 ? "9+" : unreadAlerts}
                </span>
              )}
            </button>
          ))}
          <div className="mt-2 flex gap-2 border-t border-stone-200 pt-3">
            {currentUser ? (
              <button
                onClick={async () => {
                  await signOut();
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
