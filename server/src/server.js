require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { sequelize, ensureDatabase } = require("./config/database");
require("./models");

const animalRoutes = require("./routes/animalRoutes");
const authRoutes = require("./routes/authRoutes");
const alertRoutes = require("./routes/alertRoutes");

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
  await sequelize.sync({ alter: true });
  console.log("[db] Connected and synced (animals, users, alert_subscriptions).");
  app.listen(PORT, () => console.log(`[api] AnimalID server listening on port ${PORT}`));
}

start().catch((err) => {
  console.error("[fatal] Could not start server:", err.message);
  process.exit(1);
});
