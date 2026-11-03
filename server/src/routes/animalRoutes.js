const { Router } = require("express");
const upload = require("../middleware/upload");
const { limiters } = require("../middleware/rateLimit");
const { requireAuth, optionalAuth } = require("../controllers/authController");
const {
  listAnimals,
  getAnimal,
  createAnimal,
  updateAnimal,
  deleteAnimal,
  reportSighting,
  scanPhoto,
  reindexEmbeddings,
  requireOwner,
} = require("../controllers/animalController");

const router = Router();

const photoFields = upload.fields([
  { name: "front", maxCount: 1 },
  { name: "left", maxCount: 1 },
  { name: "right", maxCount: 1 },
  { name: "mark", maxCount: 1 },
]);

router.get("/", listAnimals);
router.post("/scan", limiters.scan(), optionalAuth, upload.single("photo"), scanPhoto);
// Maintenance-only: authenticated + tightly throttled so the whole-DB
// embedding pass can never be triggered anonymously or in a loop.
router.post("/reindex", requireAuth, limiters.heavy(), reindexEmbeddings);
router.get("/:id", getAnimal);
// Registration requires a signed-in owner (the UI gates here too); auth runs
// before multer so rejected callers never write upload files.
router.post("/", requireAuth, limiters.upload(), photoFields, createAnimal);
// Owner-only alert/profile editing: auth runs before multer so rejected
// callers never write upload files. Sightings need a signed-in reporter
// (identity is recorded) but any user — never just the owner — may report.
router.put("/:id", requireAuth, requireOwner, photoFields, updateAnimal);
router.delete("/:id", requireAuth, requireOwner, deleteAnimal);
router.post("/:id/sightings", requireAuth, limiters.sighting(), reportSighting);

module.exports = router;
