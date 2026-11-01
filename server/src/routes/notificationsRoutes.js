const { Router } = require("express");
const { requireAuth } = require("../controllers/authController");
const { listMine, readAll } = require("../controllers/notificationsController");

const router = Router();

router.get("/", requireAuth, listMine);
router.post("/read-all", requireAuth, readAll);

module.exports = router;
