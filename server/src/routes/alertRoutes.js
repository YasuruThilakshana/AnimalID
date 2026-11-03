const { Router } = require("express");
const AlertSubscription = require("../models/AlertSubscription");
const { limiters } = require("../middleware/rateLimit");

const router = Router();

// Open by design (guests subscribe to lost-pet alerts) but throttled like
// password mailers so the endpoint can't be used to flood inboxes or rows.
router.post("/subscribe", limiters.password(), async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const location = String(req.body.location || "").trim();
    if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email to subscribe." });
    }
    if (location.length > 160) {
      return res.status(400).json({ error: "Please keep the location under 160 characters." });
    }
    await AlertSubscription.create({ email, location });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
