const { Router } = require("express");
const upload = require("../middleware/upload");
const {
  listAnimals,
  getAnimal,
  createAnimal,
  updateAnimal,
  deleteAnimal,
  reportSighting,
  scanPhoto,
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
router.get("/:id", getAnimal);
router.post("/", photoFields, createAnimal);
router.put("/:id", photoFields, updateAnimal);
router.delete("/:id", deleteAnimal);
router.post("/:id/sightings", reportSighting);

module.exports = router;
