const { Router } = require("express");
const { register, login, me, requireAuth } = require("../controllers/authController");

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", requireAuth, me);

module.exports = router;
