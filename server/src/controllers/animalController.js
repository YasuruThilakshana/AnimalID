const fs = require("fs");
const { Op } = require("sequelize");
const Animal = require("../models/Animal");
const { getImageEmbedding } = require("../services/samService");
const { cosineSimilarity, toPercentage } = require("../utils/similarity");

const PHOTO_ANGLES = ["front", "left", "right", "mark"];

function publicUrl(req, filename) {
  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
}

function parseJsonField(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Merge uploaded angle files + retained photo URLs into the photos map. */
function buildPhotos(req, existing = {}) {
  const photos = { ...existing };
  const retained = parseJsonField(req.body.photos, {});
  for (const angle of PHOTO_ANGLES) {
    if (typeof retained[angle] === "string" && retained[angle]) {
      photos[angle] = retained[angle];
    }
  }
  const files = req.files || {};
  for (const angle of PHOTO_ANGLES) {
    const uploaded = Array.isArray(files[angle]) ? files[angle][0] : files[angle];
    if (uploaded && uploaded.filename) {
      photos[angle] = publicUrl(req, uploaded.filename);
    }
  }
  return photos;
}

function pickFields(source, allowed) {
  const out = {};
  for (const key of allowed) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

const EDITABLE_FIELDS = [
  "name",
  "species",
  "breed",
  "age",
  "gender",
  "color",
  "weight",
  "location",
  "marks",
  "status",
  "ownerName",
  "ownerEmail",
  "contact",
  "vet",
  "imageUrl",
];

async function listAnimals(req, res, next) {
  try {
    const { q, species, status, location, owner } = req.query;
    const where = {};
    if (species) where.species = species;
    if (status) where.status = status;
    if (owner) where.ownerEmail = String(owner).toLowerCase();
    if (location) where.location = { [Op.like]: `%${location}%` };
    if (q) {
      const like = { [Op.like]: `%${q}%` };
      where[Op.and] = [
        {
          [Op.or]: [
            { name: like },
            { breed: like },
            { color: like },
            { marks: like },
            { location: like },
            { tagNumber: like },
          ],
        },
      ];
    }
    const animals = await Animal.findAll({ where, order: [["createdAt", "DESC"]] });
    res.json(animals);
  } catch (err) {
    next(err);
  }
}

async function getAnimal(req, res, next) {
  try {
    const animal = await Animal.findByPk(req.params.id);
    if (!animal) return res.status(404).json({ error: "Animal not found." });
    res.json(animal);
  } catch (err) {
    next(err);
  }
}

async function createAnimal(req, res, next) {
  try {
    const data = pickFields(req.body, EDITABLE_FIELDS);
    if (!data.name || String(data.name).trim().length < 2) {
      return res.status(400).json({ error: "Name (2+ characters) is required." });
    }
    if (data.ownerEmail) data.ownerEmail = String(data.ownerEmail).toLowerCase();
    data.name = String(data.name).trim();

    const photos = buildPhotos(req);
    data.photos = photos;
    data.imageUrl = data.imageUrl || photos.front || null;
    data.timeline = [{ t: Date.now(), text: "Registered on AnimalID" }];
    data.sightings = [];

    const animal = await Animal.create(data);

    // Generate and store the feature embedding from the front photo so the
    // scanner can match against this record later.
    const frontFile = req.files?.front?.[0];
    if (frontFile) {
      try {
        const buffer = fs.readFileSync(frontFile.path);
        animal.embedding = await getImageEmbedding(buffer, frontFile.mimetype);
        await animal.save({ fields: ["embedding"] });
      } catch (err) {
        console.warn("[animals] embedding generation failed:", err.message);
      }
    }

    await animal.reload();
    res.status(201).json(animal);
  } catch (err) {
    next(err);
  }
}

async function updateAnimal(req, res, next) {
  try {
    const animal = await Animal.findByPk(req.params.id);
    if (!animal) return res.status(404).json({ error: "Animal not found." });

    const data = pickFields(req.body, EDITABLE_FIELDS);
    if (data.ownerEmail) data.ownerEmail = String(data.ownerEmail).toLowerCase();
    if (data.name) data.name = String(data.name).trim();

    const photos = buildPhotos(req, animal.photos || {});
    data.photos = photos;
    if (!data.imageUrl) data.imageUrl = photos.front || animal.imageUrl || null;

    const sightings = parseJsonField(req.body.sightings, undefined);
    if (sightings !== undefined) data.sightings = sightings;
    const timeline = parseJsonField(req.body.timeline, undefined);
    if (timeline !== undefined) data.timeline = timeline;

    await animal.update(data);

    const frontFile = req.files?.front?.[0];
    if (frontFile) {
      try {
        const buffer = fs.readFileSync(frontFile.path);
        animal.embedding = await getImageEmbedding(buffer, frontFile.mimetype);
        await animal.save({ fields: ["embedding"] });
      } catch (err) {
        console.warn("[animals] embedding generation failed:", err.message);
      }
    }

    await animal.reload();
    res.json(animal);
  } catch (err) {
    next(err);
  }
}

async function deleteAnimal(req, res, next) {
  try {
    const animal = await Animal.findByPk(req.params.id);
    if (!animal) return res.status(404).json({ error: "Animal not found." });
    await animal.destroy();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function reportSighting(req, res, next) {
  try {
    const animal = await Animal.findByPk(req.params.id);
    if (!animal) return res.status(404).json({ error: "Animal not found." });
    const { place, note } = req.body;
    if (!place || String(place).trim().length < 3) {
      return res.status(400).json({ error: "A sighting place is required." });
    }
    const sighting = { t: Date.now(), place: String(place).trim(), note: String(note || "").trim() };
    await animal.update({
      sightings: [...(animal.sightings || []), sighting],
      timeline: [
        ...(animal.timeline || []),
        { t: Date.now(), text: `Sighting reported at ${sighting.place}` },
      ],
    });
    await animal.reload();
    res.status(201).json(animal);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/animals/scan — photo search scanner.
 * Accepts a multipart `photo` file, generates its embedding via Meta AI
 * SAM 3.1, compares it against stored embeddings with cosine similarity,
 * and returns the best match plus a ranked list with match percentages.
 */
async function scanPhoto(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Upload a photo file as the 'photo' field." });
    }
    const buffer = fs.readFileSync(req.file.path);
    const queryEmbedding = await getImageEmbedding(buffer, req.file.mimetype);

    const { species, markings, location } = req.body;
    const animals = await Animal.findAll({ order: [["createdAt", "DESC"]] });

    const markTokens = String(markings || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);
    const locNeedle = String(location || "").toLowerCase().trim();

    const matches = animals.map((animal) => {
      const stored = animal.embedding;
      let score = Array.isArray(stored) && stored.length ? toPercentage(cosineSimilarity(queryEmbedding, stored)) : 0;
      const reasons = [];

      if (species && species !== "Unknown" && animal.species === species) {
        score += 4;
        reasons.push(`Species match (${animal.species})`);
      }
      if (markTokens.length) {
        const hay = `${animal.color} ${animal.marks} ${animal.breed} ${animal.name}`.toLowerCase();
        const hits = [...new Set(markTokens.filter((t) => hay.includes(t)))];
        if (hits.length) {
          score += Math.min(8, hits.length * 3);
          reasons.push(`Markings overlap: ${hits.slice(0, 3).join(", ")}`);
        }
      }
      if (locNeedle && String(animal.location || "").toLowerCase().includes(locNeedle)) {
        score += 3;
        reasons.push(`Same area (${animal.location})`);
      }
      if (animal.status === "lost") {
        score += 2;
        reasons.push("Actively reported lost");
      }
      if (!reasons.length) reasons.push("Visual embedding similarity");

      score = Math.max(0, Math.min(99, Math.round(score * 100) / 100));
      const band = score >= 80 ? "High" : score >= 60 ? "Medium" : "Low";
      return { animal, score, band, reasons: reasons.slice(0, 4) };
    });

    matches.sort((a, b) => b.score - a.score);
    const best = matches[0] || null;

    res.json({
      match: best
        ? { animal: best.animal, similarity: best.score, band: best.band, reasons: best.reasons }
        : null,
      matches,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listAnimals,
  getAnimal,
  createAnimal,
  updateAnimal,
  deleteAnimal,
  reportSighting,
  scanPhoto,
};
