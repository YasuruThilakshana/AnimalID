/**
 * Last-resort process nets. Every request path is guarded (controllers
 * try/catch into the API error boundary), so these only fire for truly
 * unexpected faults (a failed boot dependency, a driver bug). They log and
 * keep serving instead of dropping all concurrent users; a supervisor
 * (systemd/PM2/Docker restart policy) remains the backstop for a wedged
 * process. Installed exactly once.
 */
let installed = false;

function installProcessGuards() {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => {
    console.error("[fatal] unhandled rejection:", reason && reason.message ? reason.message : reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[fatal] uncaught exception:", err && err.message ? err.message : err);
  });
}

module.exports = { installProcessGuards };
