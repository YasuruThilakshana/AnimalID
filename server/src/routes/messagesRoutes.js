const { Router } = require("express");
const multer = require("multer");
const upload = require("../middleware/upload");
const { limiters } = require("../middleware/rateLimit");
const { requireAuth } = require("../controllers/authController");
const {
  sendMessage,
  listThreads,
  getThread,
  markThreadRead,
  unreadCount,
  getPeerByEmail,
  uploadMessageImage,
} = require("../controllers/messagesController");

const router = Router();

// Chat-local multer error adapter: oversized or wrong-type photos answer
// 400 here instead of falling through to the generic 500 handler.
function chatPhotoUpload(req, res, next) {
  upload.single("image")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Photos must be under 8MB." });
    }
    return res.status(400).json({ error: err.message || "Could not upload that photo." });
  });
}

router.get("/peer", requireAuth, getPeerByEmail);
router.post("/image", requireAuth, limiters.upload(), chatPhotoUpload, uploadMessageImage);
router.get("/threads", requireAuth, listThreads);
router.get("/thread/:userId", requireAuth, getThread);
router.post("/thread/:userId/read", requireAuth, markThreadRead);
router.post("/", requireAuth, limiters.message(), sendMessage);
router.get("/unread-count", requireAuth, unreadCount);

module.exports = router;
