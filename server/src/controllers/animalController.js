const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Op } = require("sequelize");
const Animal = require("../models/Animal");
const Notification = require("../models/Notification");
const { extractAnimalFeatures, getEmbeddingEngine, EMBEDDING_VERSION } = require("../services/samService");
const {
  cosineSimilarity,
  toPercentage,
  rankByScore,
  normalizeVector,
  cascadeMatch,
  weightedMicroSimilarity,
  STAGE1_MIN_VISUAL,
  STAGE2_MIN_CONFIDENCE,
  MICRO_SPATIAL_WEIGHTS,
} = require("../utils/similarity");

const PHOTO_ANGLES = ["front", "left", "right", "mark"];

// Valid-match cutoff: a top score at/above this % counts as a confident match.
// The top-N ranked candidates are ALWAYS returned so existing/similar photos
// are never missed; the frontend highlights scores >= cutoff as valid.
const DEFAULT_MIN_SCORE = Number(process.env.SCAN_MIN_SCORE) || 50;
const DEFAULT_TOP_MATCHES = Number(process.env.SCAN_TOP_MATCHES) || 3;
const MAX_BOOST = 4; // hint boosts can never turn a weak visual match into a hit

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

/** All uploaded angle files (front first) for multi-angle fusion. */
function angleFiles(files) {
  const out = [];
  if (!files) return out;
  for (const angle of PHOTO_ANGLES) {
    const entry = Array.isArray(files[angle]) ? files[angle][0] : files[angle];
    if (entry && entry.path) out.push(entry);
  }
  return out;
}

/**
 * Generate + persist SAM embeddings for an animal through the exact same
 * pipeline the scanner uses. Each uploaded angle stores BOTH its SAM-guided
 * vector and its deterministic local vector, plus a fused identity vector —
 * so scanning any registered photo scores ~100% against its own angle no
 * matter which pipeline ran on either side.
 */
async function storeEmbedding(animal, files) {
  const uploads = angleFiles(files);
  if (!uploads.length) return;
  const inputs = uploads.map((file) => {
    const angle = PHOTO_ANGLES.includes(file.fieldname) ? file.fieldname : "front";
    return { angle, buffer: fs.readFileSync(file.path), mimetype: file.mimetype };
  });
  await embedBuffers(animal, inputs, "upload");
}

/**
 * Extract + persist dual (SAM-guided + deterministic local) vectors from
 * in-memory image buffers. Shared by registration uploads and the reindex
 * endpoint so both always produce identical vectors for identical bytes.
 * Stores BOTH the fused global embedding and the fused fine-grained
 * micro-biometric embedding (plus per-angle micro vectors).
 */
async function embedBuffers(animal, inputs, source = "upload") {
  const fresh = {};
  const methods = {};
  for (const { angle, buffer, mimetype } of inputs) {
    try {
      const features = await extractAnimalFeatures(buffer, mimetype);
      if (Array.isArray(features.embedding) && features.embedding.length) {
        fresh[angle] = {
          sam: features.embedding,
          local: features.localEmbedding,
          micro: features.microEmbedding,
          localMicro: features.localMicroEmbedding,
        };
        methods[angle] = features.engine;
      }
    } catch (err) {
      console.warn(`[animals] embedding failed for angle ${angle}:`, err.message);
    }
  }
  const merged = { ...(animal.angleEmbeddings || {}), ...fresh };
  const primaries = Object.values(merged)
    .map((entry) => (Array.isArray(entry) ? entry : entry && entry.sam))
    .filter((v) => Array.isArray(v) && v.length);
  if (!primaries.length) {
    console.warn(`[animals] embedding generation failed for all ${source} angles.`);
    return false;
  }
  const fused = meanVector(primaries);
  const microVectors = Object.values(merged)
    .map((entry) => (entry && typeof entry === "object" && !Array.isArray(entry) ? entry.micro : null))
    .filter((v) => validVec(v));
  const fusedMicro = microVectors.length
    ? meanVector(microVectors)
    : validVec(animal.microBiometricEmbedding)
      ? animal.microBiometricEmbedding
      : null;
  animal.angleEmbeddings = merged;
  animal.embedding = fused;
  animal.globalEmbedding = fused;
  if (fusedMicro) animal.microBiometricEmbedding = fusedMicro;
  animal.embeddingVer = EMBEDDING_VERSION;
  await animal.save({
    fields: ["embedding", "globalEmbedding", "microBiometricEmbedding", "angleEmbeddings", "embeddingVer"],
  });
  console.log(`[animals] embeddings stored for #${animal.id} (${source}):`, {
    angles: Object.keys(merged),
    methods,
    version: EMBEDDING_VERSION,
    fused: vectorFingerprint(fused),
    micro: fusedMicro ? vectorFingerprint(fusedMicro) : null,
  });
  return true;
}

/** True for a usable (non-empty array) embedding vector. */
function validVec(vector) {
  return Array.isArray(vector) && vector.length > 0;
}

/** Element-wise mean of same-space vectors, normalized. */
function meanVector(vectors) {
  const dim = Math.max(...vectors.map((v) => v.length));
  const mean = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) mean[i] += Number(v[i % v.length]) || 0;
  }
  return normalizeVector(mean.map((v) => v / vectors.length));
}

/** Compact embedding fingerprint for reg-vs-scan comparison in logs. */
function vectorFingerprint(vector) {
  const nums = vector.map(Number);
  const norm = Math.sqrt(nums.reduce((sum, v) => sum + v * v, 0));
  const rounded = nums.map((v) => Math.round(v * 1e6) / 1e6);
  const hash = crypto.createHash("sha1").update(JSON.stringify(rounded)).digest("hex").slice(0, 12);
  return {
    dims: nums.length,
    norm: Math.round(norm * 1e4) / 1e4,
    head: rounded.slice(0, 6),
    hash,
  };
}

/** Serialize an animal for scan results (embeddings stay server-side). */
function toScanAnimal(animal) {
  const plain = typeof animal.toJSON === "function" ? animal.toJSON() : { ...animal };
  delete plain.embedding;
  delete plain.globalEmbedding;
  delete plain.microBiometricEmbedding;
  delete plain.microEmbedding;
  delete plain.angleEmbeddings;
  return plain;
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
  "lostLocation",
  "marks",
  "status",
  "ownerName",
  "ownerEmail",
  "contact",
  "vet",
  "imageUrl",
];

/**
 * Owner-only gate for alert creation/editing: the verified JWT identity must
 * match the pet's registered owner. Ownership in this codebase is keyed by
 * owner email (unique per account, so equivalent in strength to a user-id
 * match): only the owner may trigger a Missing/Lost alert, modify its missing
 * status, or edit/delete the profile behind it. Attaches the record as
 * req.animal so handlers don't fetch twice.
 */
async function requireOwner(req, res, next) {
  try {
    const animal = await Animal.findByPk(req.params.id);
    if (!animal) return res.status(404).json({ error: "Animal not found." });
    const owner = String(animal.ownerEmail || "").toLowerCase();
    const caller = String(req.user?.email || "").toLowerCase();
    if (!owner || owner !== caller) {
      return res.status(403).json({ error: "Only the verified owner can modify this pet's alert." });
    }
    req.animal = animal;
    next();
  } catch (err) {
    next(err);
  }
}

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
    const animals = await Animal.findAll({
      where,
      order: [["createdAt", "DESC"]],
      attributes: { exclude: ["embedding", "globalEmbedding", "microBiometricEmbedding", "angleEmbeddings"] },
    });
    res.json(animals);
  } catch (err) {
    next(err);
  }
}

async function getAnimal(req, res, next) {
  try {
    const animal = await Animal.findByPk(req.params.id, {
      attributes: { exclude: ["embedding", "globalEmbedding", "microBiometricEmbedding", "angleEmbeddings"] },
    });
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

    // Generate and store the feature embedding from the uploaded photo so the
    // scanner can match against this record later.
    await storeEmbedding(animal, req.files);

    await animal.reload();
    res.status(201).json(toScanAnimal(animal));
  } catch (err) {
    next(err);
  }
}

async function updateAnimal(req, res, next) {
  try {
    const animal = req.animal || (await Animal.findByPk(req.params.id));
    if (!animal) return res.status(404).json({ error: "Animal not found." });

    const data = pickFields(req.body, EDITABLE_FIELDS);
    if (data.ownerEmail) data.ownerEmail = String(data.ownerEmail).toLowerCase();
    if (data.name) data.name = String(data.name).trim();
    if (typeof data.lostLocation === "string") data.lostLocation = data.lostLocation.trim();
    // Missing-alert lifecycle: the incident location only exists while the
    // pet is lost. Leaving "lost" clears it; reporting lost without one keeps
    // whatever was set; unrelated edits leave the alert untouched.
    if (data.status !== undefined && data.status !== "lost") data.lostLocation = "";

    const photos = buildPhotos(req, animal.photos || {});
    data.photos = photos;
    if (!data.imageUrl) data.imageUrl = photos.front || animal.imageUrl || null;

    const sightings = parseJsonField(req.body.sightings, undefined);
    if (sightings !== undefined) data.sightings = sightings;
    const timeline = parseJsonField(req.body.timeline, undefined);
    if (timeline !== undefined) data.timeline = timeline;

    await animal.update(data);

    await storeEmbedding(animal, req.files);

    await animal.reload();
    res.json(toScanAnimal(animal));
  } catch (err) {
    next(err);
  }
}

async function deleteAnimal(req, res, next) {
  try {
    const animal = req.animal || (await Animal.findByPk(req.params.id));
    if (!animal) return res.status(404).json({ error: "Animal not found." });
    // Permanent delete: remove stored photo files first, then the DB row
    // (profile, embeddings, sightings, and timeline go with it).
    const removed = deletePhotoFiles(animal);
    await animal.destroy();
    console.log(`[animals] permanently deleted #${animal.id} (${animal.tagNumber || "untagged"}): ${removed} photo file(s) removed.`);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * Delete an animal's uploaded photo files from disk. Only files inside the
 * local uploads directory are touched; data URLs and remote URLs are skipped.
 * Returns the number of files removed.
 */
function deletePhotoFiles(animal) {
  const urls = new Set();
  const photos = (animal && animal.photos) || {};
  for (const angle of PHOTO_ANGLES) {
    if (typeof photos[angle] === "string" && photos[angle]) urls.add(photos[angle]);
  }
  if (typeof animal.imageUrl === "string" && animal.imageUrl) urls.add(animal.imageUrl);
  const uploadsDir = path.join(__dirname, "..", "..", "uploads");
  let removed = 0;
  for (const url of urls) {
    if (!url.includes("/uploads/")) continue;
    const filename = path.basename(url.split("?")[0]);
    if (!filename || filename === "." || filename === "..") continue;
    const filePath = path.normalize(path.join(uploadsDir, filename));
    // Never delete outside the uploads directory.
    if (!filePath.startsWith(path.normalize(uploadsDir + path.sep))) continue;
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        removed += 1;
      }
    } catch (err) {
      console.warn(`[animals] could not delete photo file ${filename}:`, err.message);
    }
  }
  return removed;
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
    res.status(201).json(toScanAnimal(animal));
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/animals/scan — photo search scanner with 2-stage cascade
 * verification for high-precision fine-grained biometric differentiation
 * (even identical twins / lookalike animals).
 *
 * 1. Segments the animal from the background and extracts weighted
 *    multi-region embeddings via the SAME pipeline used at registration —
 *    both a SAM-guided vector and a deterministic local vector — PLUS the
 *    localized biometric micro-crops (facial mask, muzzle/nose print, ear
 *    pattern, coat markings) fused into one normalized micro vector.
 * 2. Compares against EVERY stored animal embedding (fused + each registered
 *    angle × each pipeline, best combo wins) with high-precision cosine
 *    similarity on the global vectors AND weighted micro-feature similarity.
 * 3. STRICTLY scopes results to one species (requested, or auto-detected from
 *    the strongest pure-visual score) and ALWAYS returns its top-N ranked
 *    candidates with a confidence breakdown (species category match vs.
 *    fine-grained biometric unique match).
 * 4. A top candidate counts as a confident match only when it clears the
 *    STRICT biometric gate — stage 1 (same species AND baseline visual > 85%)
 *    AND stage 2 (micro-biometric cutoff) AND weighted confidence at the
 *    confidence threshold — plus the score cutoff. Below that the scan
 *    returns match: null with ranked suggestions marked unverified, so a
 *    new/unseen pet sharing background or fur color can never false-match.
 */
async function scanPhoto(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Upload a photo file as the 'photo' field." });
    }

    let features;
    try {
      const buffer = fs.readFileSync(req.file.path);
      features = await extractAnimalFeatures(buffer, req.file.mimetype);
    } catch (err) {
      return res.status(422).json({ error: `Could not analyze that photo: ${err.message}` });
    } finally {
      // Scan uploads are transient — remove the temp file (best effort).
      fs.promises.unlink(req.file.path).catch(() => {});
    }
    const queryEmbedding = normalizeVector(features.globalEmbedding || features.embedding);
    const queryLocal = normalizeVector(features.localEmbedding || []);
    const queryMicro = normalizeVector(features.microEmbedding || []);
    const queryLocalMicro = normalizeVector(features.localMicroEmbedding || features.microEmbedding || []);

    const threshold = clampNumber(req.body.minScore, 0, 99, DEFAULT_MIN_SCORE);
    const topN = Math.max(1, Math.min(20, Math.round(Number(req.body.topN)) || DEFAULT_TOP_MATCHES));
    const { species, markings, location } = req.body;
    const animals = await Animal.findAll({ order: [["createdAt", "DESC"]] });

    console.log("[scan] query embedding:", {
      method: features.engine,
      primary: vectorFingerprint(queryEmbedding),
      local: vectorFingerprint(queryLocal),
      micro: queryMicro.length ? vectorFingerprint(queryMicro) : null,
    });

    const markTokens = String(markings || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);
    const locNeedle = String(location || "").toLowerCase().trim();

    let staleEmbeddings = 0;
    let withoutEmbeddings = 0;
    const scored = [];
    for (const animal of animals) {
      const current = animal.embeddingVer === EMBEDDING_VERSION;
      const candidates = comparableVectors(animal, current);
      if (!candidates.length) {
        if (hasAnyVector(animal) && !current) staleEmbeddings += 1;
        else withoutEmbeddings += 1;
        continue;
      }
      // Best combo wins: each query pipeline (SAM-guided + deterministic
      // local) matches the fused identity AND every registered angle, so the
      // exact same photo always scores ~100% via local-vs-local at minimum.
      // Stage-2 micro detail is scored the same way (best micro combo wins).
      const { visual, view, pipeline, vecHash } = scoreCandidates(queryEmbedding, queryLocal, candidates);
      const micro = bestMicroScore(queryMicro, queryLocalMicro, candidates);

      // Optional hint boosts: small, capped, and never enough to rescue a
      // weak visual match on their own. (Species needs no boost: matching is
      // strictly same-species, so it would be a constant offset.)
      let boost = 0;
      const reasons = [`Visual similarity ${visual.toFixed(1)}%`];
      if (micro !== null) reasons.push(`Fine-grained biometric ${micro.toFixed(1)}%`);
      if (view !== "fused") reasons.push(`Closest view: ${view}`);
      if (markTokens.length) {
        const hay = `${animal.color} ${animal.marks} ${animal.breed} ${animal.name}`.toLowerCase();
        const hits = [...new Set(markTokens.filter((t) => hay.includes(t)))];
        if (hits.length) {
          boost += Math.min(1.5, hits.length * 0.75);
          reasons.push(`Markings overlap: ${hits.slice(0, 3).join(", ")}`);
        }
      }
      if (locNeedle && String(animal.location || "").toLowerCase().includes(locNeedle)) {
        boost += 0.75;
        reasons.push(`Same area (${animal.location})`);
      }
      if (animal.status === "lost") {
        boost += 0.25;
        reasons.push("Actively reported lost");
      }
      boost = Math.min(MAX_BOOST, boost);

      // Provisional legacy-style score drives species auto-detection exactly
      // as before; the cascade confidence finalizes it once the species scope
      // is known (stage 1 needs the same-species verdict).
      const provisional = Math.max(0, Math.min(99.99, Math.round((visual + boost) * 100) / 100));
      scored.push({
        animal: toScanAnimal(animal),
        score: provisional,
        visual,
        micro,
        boost,
        view,
        pipeline,
        vecHash,
        reasons: reasons.slice(0, 4),
      });
    }

    console.log(
      `[scan] DB records: total=${animals.length} scored=${scored.length} ` +
        `stale=${staleEmbeddings} withoutEmbeddings=${withoutEmbeddings}`,
    );
    const provisionalRanked = rankByScore(scored);

    // STRICT species scoping: compare within one species only, so a Dog scan
    // can never return an Elephant (or Cat) as a match or a suggestion.
    const requestedSpecies = species && species !== "Unknown" ? species : null;
    let detectedSpecies = requestedSpecies;
    if (!detectedSpecies && provisionalRanked.length) {
      // Auto-detect from the strongest PURE VISUAL score (boosts excluded so
      // text/location hints can't drag in the wrong species).
      let topVisual = null;
      for (const entry of provisionalRanked) {
        if (!topVisual || entry.visual > topVisual.visual) topVisual = entry;
      }
      detectedSpecies = topVisual ? topVisual.animal.species : null;
    }

    // Stage 1 + 2 finalize every candidate now that the species scope is
    // known: cascade confidence (micro-weighted, twin-penalized) replaces the
    // raw visual as the ranking base; hint boosts still apply on top, capped.
    const finalized = provisionalRanked.map((entry) => {
      const sameSpecies = detectedSpecies ? entry.animal.species === detectedSpecies : false;
      const cascade = cascadeMatch({ globalScore: entry.visual, microScore: entry.micro, sameSpecies });
      const score = Math.max(0, Math.min(99.99, Math.round((cascade.confidence + entry.boost) * 100) / 100));
      const band = score >= 85 ? "High" : score >= 65 ? "Medium" : "Low";
      return {
        animal: entry.animal,
        score,
        visual: entry.visual,
        micro: entry.micro,
        confidence: cascade.confidence,
        confidenceBreakdown: {
          speciesCategoryMatch: sameSpecies ? 100 : 0,
          globalVisual: entry.visual,
          biometricUniqueMatch: entry.micro,
          final: cascade.confidence,
        },
        stage1Pass: cascade.stage1Pass,
        stage2Pass: cascade.stage2Pass,
        verified: cascade.verified,
        band,
        reasons: entry.reasons,
        view: entry.view,
        pipeline: entry.pipeline,
        vecHash: entry.vecHash,
      };
    });
    const ranked = rankByScore(finalized);
    const scores = ranked.map((m) => ({
      id: m.animal.id,
      tag: m.animal.tagNumber,
      name: m.animal.name,
      species: m.animal.species,
      score: m.score,
      visual: m.visual,
      micro: m.micro,
      confidence: m.confidence,
      stage1: m.stage1Pass,
      view: m.view,
      pipeline: m.pipeline,
      vec: m.vecHash,
    }));
    console.log("Calculated Similarity Scores:", scores);

    const sameSpecies = detectedSpecies ? ranked.filter((m) => m.animal.species === detectedSpecies) : [];
    console.log(
      `[scan] species scope: requested=${requestedSpecies || "auto"} detected=${detectedSpecies || "none"} ` +
        `kept=${sameSpecies.length}/${ranked.length}`,
    );
    const stage1Passed = ranked.filter((m) => m.stage1Pass).length;
    const verified = ranked.filter((m) => m.verified).length;
    console.log(`[scan] cascade: stage1Passed=${stage1Passed} verified=${verified} threshold=${STAGE1_MIN_VISUAL}`);

    // Always return the top-N ranked same-species candidates as suggestions
    // (each marked verified true/false). Only a top candidate that clears the
    // STRICT biometric gate — stage 1 AND stage 2 AND weighted confidence at
    // the confidence threshold — plus the score cutoff is a confident match;
    // anything below returns match: null so unregistered pets never
    // false-match.
    const matches = sameSpecies.slice(0, topN);
    const top = matches[0] || null;
    const best = top && top.verified && top.score >= threshold ? top : null;

    // A confident 100% verified match on a reported-missing pet instantly
    // notifies the owner (bell + Ash Chat). Best effort: a notification
    // failure must never fail the public scan itself.
    let ownerNotified = false;
    if (best) {
      try {
        const scanLocation = String(req.body.location || "").trim() || null;
        ownerNotified = (await maybeNotifyFoundScan({ match: best, scanLocation })).notified;
      } catch (err) {
        console.warn("[scan] owner notification failed:", err.message);
      }
    }

    res.json({
      ownerNotified,
      match: best
        ? {
            animal: best.animal,
            similarity: best.score,
            visual: best.visual,
            micro: best.micro,
            confidence: best.confidence,
            confidenceBreakdown: best.confidenceBreakdown,
            stage1Pass: best.stage1Pass,
            stage2Pass: best.stage2Pass,
            verified: best.verified,
            view: best.view,
            pipeline: best.pipeline,
            band: best.band,
            reasons: best.reasons,
          }
        : null,
      matches,
      totalCompared: animals.length,
      scored: ranked.length,
      stage1Passed,
      verified,
      staleEmbeddings,
      withoutEmbeddings,
      threshold,
      topN,
      detectedSpecies,
      speciesRequested: requestedSpecies,
      engine: getEmbeddingEngine(),
      segmentation: features.segmentation,
      cascade: {
        stage1Threshold: STAGE1_MIN_VISUAL,
        stage2Confidence: STAGE2_MIN_CONFIDENCE,
        microWeights: MICRO_SPATIAL_WEIGHTS,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** Stored global vector: explicit global_embedding, else legacy embedding. */
function storedGlobal(animal) {
  if (validVec(animal.globalEmbedding)) return animal.globalEmbedding;
  return animal.embedding;
}

/** Stored fused micro vector (null for legacy records without one). */
function storedMicro(animal) {
  if (validVec(animal.microBiometricEmbedding)) return animal.microBiometricEmbedding;
  if (validVec(animal.microEmbedding)) return animal.microEmbedding;
  return null;
}

/**
 * Comparable (current-version) vectors: fused + each angle × each pipeline,
 * each paired with its micro-biometric vector for stage-2 matching
 * ({ label, vector, micro }; micro is null on legacy records).
 */
function comparableVectors(animal, current) {
  if (!current) return [];
  const out = [];
  const push = (label, vector, micro = null) => {
    if (validVec(vector)) out.push({ label, vector, micro: validVec(micro) ? micro : null });
  };
  push("fused", storedGlobal(animal), storedMicro(animal));
  const angles = animal.angleEmbeddings;
  const locals = [];
  const localMicros = [];
  if (angles && typeof angles === "object" && !Array.isArray(angles)) {
    for (const [angle, entry] of Object.entries(angles)) {
      if (Array.isArray(entry)) {
        push(angle, entry, null); // legacy single-vector shape
      } else if (entry && typeof entry === "object") {
        const micro = validVec(entry.micro)
          ? entry.micro
          : validVec(entry.microBiometric)
            ? entry.microBiometric
            : null;
        const localMicro = validVec(entry.localMicro) ? entry.localMicro : micro;
        push(angle, entry.sam, micro);
        push(angle, entry.local, localMicro);
        if (validVec(entry.local)) locals.push(entry.local);
        if (validVec(localMicro)) localMicros.push(localMicro);
      }
    }
  }
  if (locals.length > 1) {
    out.push({
      label: "fused",
      vector: meanVector(locals),
      micro: localMicros.length > 1 ? meanVector(localMicros) : localMicros[0] || null,
    });
  }
  return out;
}

function hasAnyVector(animal) {
  if (Array.isArray(animal.embedding) && animal.embedding.length) return true;
  const angles = animal.angleEmbeddings;
  if (!angles || typeof angles !== "object" || Array.isArray(angles)) return false;
  return Object.values(angles).some(
    (entry) =>
      (Array.isArray(entry) && entry.length) ||
      (entry && typeof entry === "object" &&
        ((Array.isArray(entry.sam) && entry.sam.length) ||
          (Array.isArray(entry.local) && entry.local.length))),
  );
}

/**
 * Best query-pipeline × stored-vector combo. Pure function over normalized
 * cosine percentages; exported for focused testing.
 */
function scoreCandidates(queryEmbedding, queryLocal, candidates) {
  const queries = [{ pipeline: "primary", vector: queryEmbedding }];
  if (Array.isArray(queryLocal) && queryLocal.length) {
    queries.push({ pipeline: "local", vector: queryLocal });
  }
  let best = { visual: 0, view: "fused", pipeline: "primary", vecHash: null };
  for (const q of queries) {
    for (const { label, vector } of candidates) {
      const pct = toPercentage(cosineSimilarity(q.vector, normalizeVector(vector)));
      if (pct > best.visual) {
        best = { visual: pct, view: label, pipeline: q.pipeline, vecHash: vectorFingerprint(vector).hash };
      }
    }
  }
  return best;
}

/**
 * Best stage-2 micro combo: each query micro pipeline (primary + deterministic
 * local) against every stored micro vector. Returns null when either side has
 * no micro vectors (legacy record) so the caller can fall back to global-only.
 */
/**
 * Confidence floor for an automatic found-scan owner notification: effectively
 * 100% (identical photo), with a hair of tolerance for float dust. Verified +
 * missing + at/above this bar is the only combination that pages the owner.
 */
const FOUND_SCAN_MIN_CONFIDENCE = 99.99;

/**
 * Notify a missing pet's owner after a confident 100% verified scan match.
 * Pure decision plus one guarded write: skips anything unverified, below the
 * bar, not currently missing, ownerless, or already carrying an unread alert
 * (one unread notification per missing pet — repeat scans don't spam; a new
 * scan after the owner read the last one notifies again). Returns
 * { notified, notification?/reason? }.
 */
async function maybeNotifyFoundScan({ match, scanLocation }) {
  if (!match || match.verified !== true) return { notified: false, reason: "unverified" };
  if (Number(match.confidence) < FOUND_SCAN_MIN_CONFIDENCE) return { notified: false, reason: "below-threshold" };
  const animal = match.animal || {};
  if (animal.status !== "lost") return { notified: false, reason: "not-missing" };
  const ownerEmail = String(animal.ownerEmail || "").toLowerCase();
  if (!ownerEmail) return { notified: false, reason: "no-owner" };
  const petId = animal.id ?? null;
  const existing = await Notification.findOne({ where: { ownerEmail, petId, type: "found_scan", read: false } });
  if (existing) return { notified: false, reason: "already-notified" };
  const petName = animal.name || "your pet";
  const message = scanLocation
    ? `Your missing pet ${petName} has been found and scanned by a finder! Sighting details: scanned near ${scanLocation}.`
    : `Your missing pet ${petName} has been found and scanned by a finder! No sighting location was shared — check ${petName}'s profile for finder sightings.`;
  const notification = await Notification.create({
    ownerEmail,
    petId,
    petName,
    type: "found_scan",
    title: `${petName} was scanned by a finder`,
    message,
    location: scanLocation || "",
  });
  console.log(`[scan] owner notified: ${petName} (pet #${petId}) matched 100% while missing.`);
  return { notified: true, notification };
}

function bestMicroScore(queryMicro, queryLocalMicro, candidates) {
  const queries = [];
  if (validVec(queryMicro)) queries.push(queryMicro);
  if (validVec(queryLocalMicro)) queries.push(queryLocalMicro);
  let best = null;
  for (const q of queries) {
    for (const candidate of candidates) {
      if (!validVec(candidate.micro)) continue;
      const pct = weightedMicroSimilarity(q, candidate.micro);
      if (pct !== null && (best === null || pct > best)) best = pct;
    }
  }
  return best;
}

/**
 * Full per-candidate cascade score: stage-1 global visual plus stage-2
 * micro verification. Pure over normalized vectors + the species verdict;
 * exported for focused testing.
 */
function cascadeScoreCandidate(queries, candidates, sameSpecies) {
  const { visual, view, pipeline, vecHash } = scoreCandidates(
    queries.global,
    queries.local,
    candidates,
  );
  const micro = bestMicroScore(queries.micro, queries.localMicro, candidates);
  return {
    visual,
    micro,
    view,
    pipeline,
    vecHash,
    ...cascadeMatch({ globalScore: visual, microScore: micro, sameSpecies }),
  };
}

/** True when the record already carries deterministic local vectors. */
function hasLocalVectors(animal) {
  const angles = animal.angleEmbeddings;
  if (!angles || typeof angles !== "object" || Array.isArray(angles)) return false;
  return Object.values(angles).some(
    (entry) => entry && typeof entry === "object" && Array.isArray(entry.local) && entry.local.length,
  );
}

/** True when the record already carries fine-grained micro-biometric vectors. */
function hasMicroVectors(animal) {
  if (validVec(animal.microBiometricEmbedding) || validVec(animal.microEmbedding)) return true;
  const angles = animal.angleEmbeddings;
  if (!angles || typeof angles !== "object" || Array.isArray(angles)) return false;
  return Object.values(angles).some(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      (validVec(entry.micro) || validVec(entry.localMicro) || validVec(entry.microBiometric)),
  );
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * POST /api/animals/reindex — heal records whose embeddings are stale or
 * missing by re-extracting them from the stored profile photos (local upload
 * files or data URLs) through the current pipeline.
 */
async function reindexEmbeddings(_req, res, next) {
  try {
    const animals = await Animal.findAll();
    let reindexed = 0;
    let skipped = 0;
    let failed = 0;
    for (const animal of animals) {
      const needs =
        animal.embeddingVer !== EMBEDDING_VERSION ||
        !hasAnyVector(animal) ||
        !hasLocalVectors(animal) ||
        !hasMicroVectors(animal);
      if (!needs) {
        skipped += 1;
        continue;
      }
      const inputs = photoInputsFromRecord(animal);
      if (!inputs.length) {
        console.warn(`[reindex] #${animal.id} has no usable photo files; skipping.`);
        failed += 1;
        continue;
      }
      const ok = await embedBuffers(animal, inputs, "reindex");
      if (ok) reindexed += 1;
      else failed += 1;
    }
    console.log(`[reindex] done: total=${animals.length} reindexed=${reindexed} skipped=${skipped} failed=${failed}`);
    res.json({ total: animals.length, reindexed, skipped, failed });
  } catch (err) {
    next(err);
  }
}

/** Resolve a record's stored photos to { angle, buffer, mimetype } inputs. */
function photoInputsFromRecord(animal) {
  const photos = animal.photos || {};
  const inputs = [];
  for (const angle of PHOTO_ANGLES) {
    const value = photos[angle] || (angle === "front" ? animal.imageUrl : null);
    if (typeof value !== "string" || !value) continue;
    try {
      if (value.startsWith("data:image/")) {
        const header = value.slice(0, value.indexOf(","));
        const mimetype = header.slice(5, header.indexOf(";")) || "image/jpeg";
        inputs.push({ angle, buffer: Buffer.from(value.split(",")[1], "base64"), mimetype });
      } else if (value.includes("/uploads/")) {
        const filename = path.basename(value.split("?")[0]);
        const filePath = path.join(__dirname, "..", "..", "uploads", filename);
        const buffer = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        inputs.push({ angle, buffer, mimetype: ext === ".png" ? "image/png" : "image/jpeg" });
      }
    } catch (err) {
      console.warn(`[reindex] #${animal.id} angle ${angle} unreadable:`, err.message);
    }
  }
  return inputs;
}

module.exports = {
  listAnimals,
  getAnimal,
  createAnimal,
  updateAnimal,
  deleteAnimal,
  reportSighting,
  scanPhoto,
  reindexEmbeddings,
  requireOwner,
  maybeNotifyFoundScan,
  FOUND_SCAN_MIN_CONFIDENCE,
  scoreCandidates,
  bestMicroScore,
  cascadeScoreCandidate,
};
