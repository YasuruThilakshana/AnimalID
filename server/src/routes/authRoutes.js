const { Router } = require("express");
const { register, login, me, logout, requireAuth, forgotPassword, resetPassword } = require("../controllers/authController");
const { limiters } = require("../middleware/rateLimit");

const router = Router();

router.post("/register", limiters.auth(), register);
router.post("/login", limiters.auth(), login);
router.post("/logout", logout);
router.get("/me", requireAuth, me);
router.post("/forgot-password", limiters.password(), forgotPassword);
router.post("/reset-password/:token", limiters.password(), resetPassword);

module.exports = router;
