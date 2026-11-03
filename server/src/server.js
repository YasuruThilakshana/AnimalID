const path = require("path");
// Load server/.env by explicit path so startup works regardless of the
// working directory (identical file when run from server/ as usual).
const dotenvResult = require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
if (dotenvResult.error && dotenvResult.error.code !== "ENOENT" && !/ENOENT/.test(dotenvResult.error.message || "")) {
  console.warn("[env] Could not parse server/.env:", dotenvResult.error.message);
}
const express = require("express");
const cors = require("cors");
const { sequelize, ensureDatabase } = require("./config/database");
const models = require("./models");
const { syncSchema } = require("./utils/syncRepair");
const { cookieParser } = require("./middleware/cookies");
const { sanitizeInputs } = require("./middleware/sanitize");
const { apiErrorHandler } = require("./middleware/errorHandler");
const { installProcessGuards } = require("./utils/processGuards");

const animalRoutes = require("./routes/animalRoutes");
const authRoutes = require("./routes/authRoutes");
const alertRoutes = require("./routes/alertRoutes");
const assistantRoutes = require("./routes/assistantRoutes");
const notificationsRoutes = require("./routes/notificationsRoutes");
const messagesRoutes = require("./routes/messagesRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

// Reflect the caller origin with credentials so the browser sends the
// HTTP-only session cookie on cross-origin API deployments too. Cookie
// theft is contained by httpOnly + SameSite=Lax; see authController.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(cookieParser);
app.use(sanitizeInputs);
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/animals", animalRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/messages", messagesRoutes);

app.use(apiErrorHandler);

async function start() {
  // Fresh clones get here with an empty MySQL server: create the database
  // and sync every model automatically — no manual SQL imports needed.
  await ensureDatabase();
  await sequelize.authenticate();
  // Per-model sync (same tables/order as sequelize.sync): a failure names its
  // table, and MySQL 1069 (pre-existing 64+ indexes) prints the exact DROP
  // INDEX repair before failing fast.
  await syncSchema(Object.values(models), { alter: true });
  console.log("[db] Connected and synced (animals, users, alert_subscriptions, notifications, messages).");
  const server = app.listen(PORT, () => console.log(`[api] AnimalID server listening on port ${PORT}`));
  // Match the Vite proxy's 120s window: slow assistant replies must finish
  // before either side times out, and reused keep-alive proxy sockets must
  // not be closed early (that race is the ECONNRESET). headersTimeout must
  // stay above keepAliveTimeout or Node closes the socket first.
  server.timeout = 120000;
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 125000;
  return server;
}

installProcessGuards();

start().catch((err) => {
  console.error("[fatal] Could not start server:", err.message);
  process.exit(1);
});
