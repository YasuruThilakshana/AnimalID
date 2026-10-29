const { Router } = require("express");
const AlertSubscription = require("../models/AlertSubscription");

const router = Router();

router.post("/subscribe", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const location = String(req.body.location || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email to subscribe." });
    }
    await AlertSubscription.create({ email, location });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
