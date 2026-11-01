const { Router } = require("express");
const { chat } = require("../controllers/assistantController");

const router = Router();

router.post("/chat", chat);

module.exports = router;
