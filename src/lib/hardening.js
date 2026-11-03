/**
 * Production client hardening. Casual inspection barriers only (a
 * determined user can always bypass client-side blocks): disables the
 * context menu and common DevTools shortcuts in production builds, where
 * dev ergonomics no longer matter. Never active in development.
 */
export function installProductionGuards() {
  if (!import.meta.env.PROD) return;
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  document.addEventListener("keydown", (event) => {
    const key = event.key === "F12" ? "F12" : String(event.key || "").toUpperCase();
    const mod = event.ctrlKey || event.metaKey;
    if (key === "F12") {
      event.preventDefault();
      return;
    }
    if (event.ctrlKey && event.shiftKey && (key === "I" || key === "J" || key === "C")) {
      event.preventDefault();
      return;
    }
    if (mod && !event.shiftKey && key === "U") {
      event.preventDefault();
    }
  });
}
