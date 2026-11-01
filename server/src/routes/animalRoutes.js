const { Router } = require("express");
const upload = require("../middleware/upload");
const { requireAuth } = require("../controllers/authController");
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
router.post("/scan", upload.single("photo"), scanPhoto);
router.post("/reindex", reindexEmbeddings);
router.get("/:id", getAnimal);
router.post("/", photoFields, createAnimal);
// Owner-only alert/profile editing: auth runs before multer so rejected
// callers never write upload files. Sighting reports stay public so any
// finder can report without an account.
router.put("/:id", requireAuth, requireOwner, photoFields, updateAnimal);
router.delete("/:id", requireAuth, requireOwner, deleteAnimal);
router.post("/:id/sightings", reportSighting);

module.exports = router;
