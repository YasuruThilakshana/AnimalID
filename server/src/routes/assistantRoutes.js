const { Router } = require("express");
const { chat } = require("../controllers/assistantController");
const { limiters } = require("../middleware/rateLimit");

const router = Router();

router.post("/chat", limiters.chat(), chat);

module.exports = router;
