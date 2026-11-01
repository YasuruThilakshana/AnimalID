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

const animalRoutes = require("./routes/animalRoutes");
const authRoutes = require("./routes/authRoutes");
const alertRoutes = require("./routes/alertRoutes");
const assistantRoutes = require("./routes/assistantRoutes");
const notificationsRoutes = require("./routes/notificationsRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/animals", animalRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/notifications", notificationsRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[api]", err.message);
  if (err.message && err.message.includes("Only image uploads")) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

async function start() {
  // Fresh clones get here with an empty MySQL server: create the database
  // and sync every model automatically — no manual SQL imports needed.
  await ensureDatabase();
  await sequelize.authenticate();
  // Per-model sync (same tables/order as sequelize.sync): a failure names its
  // table, and MySQL 1069 (pre-existing 64+ indexes) prints the exact DROP
  // INDEX repair before failing fast.
  await syncSchema(Object.values(models), { alter: true });
  console.log("[db] Connected and synced (animals, users, alert_subscriptions, notifications).");
  app.listen(PORT, () => console.log(`[api] AnimalID server listening on port ${PORT}`));
}

start().catch((err) => {
  console.error("[fatal] Could not start server:", err.message);
  process.exit(1);
});
