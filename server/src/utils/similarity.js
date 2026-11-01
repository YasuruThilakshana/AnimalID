/**
 * High-precision cosine similarity helpers for comparing image embeddings.
 * Uses Kahan compensated summation so long vectors stay accurate.
 *
 * Cascade verification (twin/lookalike differentiation):
 *   Stage 1 — same species AND baseline global visual similarity > 85%.
 *   Stage 2 — fine-grained distance check over the micro-feature vector,
 *   weighting unique biometric textures (muzzle/nose print, facial mask)
 *   above general coat/body regions.
 */

const { BIOMETRIC_REGIONS } = require("../services/imageFeatures");

/** Stage-1 gate: baseline visual similarity must strictly exceed 85%. */
const STAGE1_MIN_VISUAL = 85;

/**
 * Micro-feature spatial weights: unique biometric textures dominate the
 * stage-2 score so twins sharing a body/coat still separate. Weights sum
 * to 1 and align with BIOMETRIC_REGIONS order in the fused micro vector.
 */
const MICRO_SPATIAL_WEIGHTS = {
  facial_mask: 0.35,
  muzzle: 0.3,
  ear_pattern: 0.2,
  coat_markings: 0.15,
};

/** Stage-2 gate: weighted micro similarity floor for a verified match. */
const STAGE2_MIN_MICRO = 80;

/**
 * A cascade confidence at/above this counts as a verified unique match.
 * Calibrated to the measured separation gap: over a same-coat sweep,
 * stranger confidence peaks at ~78 while true same-subject matches bottom
 * at ~86, so 82 splits the gap with margin on both sides. Together with the
 * stage-2 micro floor, a false verify needs BOTH an unusually high micro
 * score AND an unusually high confidence — a joint event, not a near miss.
 */
const STAGE2_MIN_CONFIDENCE = 82;

/** Confidence blend: fine-grained biometrics outweigh global body shape. */
const GLOBAL_CONFIDENCE_WEIGHT = 0.3;
const MICRO_CONFIDENCE_WEIGHT = 0.7;
/** Extra penalty per point of global-vs-micro gap (twin amplification). */
const TWIN_GAP_PENALTY = 0.25;

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) {
    return 0;
  }
  const len = Math.min(a.length, b.length);
  if (a.length !== b.length) {
    // Dimension mismatch: compare the overlapping prefix rather than failing.
    console.warn(`[similarity] dimension mismatch (${a.length} vs ${b.length}); using overlap.`);
  }
  let dot = 0;
  let dotC = 0;
  let normA = 0;
  let normAC = 0;
  let normB = 0;
  let normBC = 0;
  for (let i = 0; i < len; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    [dot, dotC] = kahan(dot, dotC, x * y);
    [normA, normAC] = kahan(normA, normAC, x * x);
    [normB, normBC] = kahan(normB, normBC, y * y);
  }
  if (normA <= 0 || normB <= 0) return 0;
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(-1, Math.min(1, similarity));
}

/** One Kahan compensated addition step; returns [newSum, newComp]. */
function kahan(sum, comp, term) {
  const y = term - comp;
  const t = sum + y;
  return [t, t - sum - y];
}

/** L2-normalize a vector (returns a new array; zero vectors pass through). */
function normalizeVector(vector) {
  if (!Array.isArray(vector) || !vector.length) return [];
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + Number(v) * Number(v), 0));
  if (!norm) return [...vector];
  return vector.map((v) => Number(v) / norm);
}

/**
 * Map a cosine similarity (-1..1) to a 0–100 match percentage, rounded to
 * two decimals. Negative similarity means "dissimilar" and maps to 0.
 */
function toPercentage(similarity) {
  if (!Number.isFinite(similarity)) return 0;
  const clamped = Math.max(0, Math.min(1, similarity));
  return Math.round(clamped * 10000) / 100;
}

/**
 * Rank scored entries in descending order of score (stable by id for ties).
 * Each entry must have a numeric `score` and `animal.id`.
 */
function rankByScore(entries) {
  return [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.animal?.id ?? "").localeCompare(String(b.animal?.id ?? ""));
  });
}

/**
 * Stage-1 gate: the candidate must be the same species AND score strictly
 * above STAGE1_MIN_VISUAL (85%) on baseline global visual similarity.
 */
function passesStage1({ visual, sameSpecies }) {
  return sameSpecies === true && Number(visual) > STAGE1_MIN_VISUAL;
}

/**
 * Stage-2 gate: a real micro-biometric comparison must exist AND score
 * at/above STAGE2_MIN_MICRO. Missing micro data (legacy record) never
 * passes — an unverifiable candidate cannot become a verified match.
 */
function passesStage2({ microScore }) {
  if (microScore === null || microScore === undefined) return false;
  return Number(microScore) >= STAGE2_MIN_MICRO;
}

/**
 * Split a fused micro vector into per-region slices in BIOMETRIC_REGIONS
 * order. Returns null for missing/invalid vectors.
 */
function splitMicroEmbedding(vector) {
  if (!Array.isArray(vector) || vector.length < BIOMETRIC_REGIONS.length) return null;
  if (!vector.every((v) => Number.isFinite(Number(v)))) return null;
  const width = Math.floor(vector.length / BIOMETRIC_REGIONS.length);
  if (!width) return null;
  return BIOMETRIC_REGIONS.map((_, i) =>
    i === BIOMETRIC_REGIONS.length - 1 ? vector.slice(i * width) : vector.slice(i * width, (i + 1) * width),
  );
}

/** Weighted mean cosine across micro slices (raw -1..1, not a percentage). */
function weightedMicroCosine(a, b, weights = MICRO_SPATIAL_WEIGHTS) {
  const slicesA = splitMicroEmbedding(a);
  const slicesB = splitMicroEmbedding(b);
  if (!slicesA || !slicesB) return null;
  let total = 0;
  let sum = 0;
  BIOMETRIC_REGIONS.forEach((name, i) => {
    const weight = Number(weights?.[name]) || 0;
    if (weight <= 0) return;
    sum += weight * cosineSimilarity(slicesA[i], slicesB[i]);
    total += weight;
  });
  if (!total) return null;
  return sum / total;
}

/**
 * Stage-2 fine-grained similarity (0–100): per-region cosine similarities
 * blended by MICRO_SPATIAL_WEIGHTS so unique biometric textures dominate.
 * Returns null when either side has no micro vector (legacy record).
 */
function weightedMicroSimilarity(a, b, weights = MICRO_SPATIAL_WEIGHTS) {
  const cosine = weightedMicroCosine(a, b, weights);
  return cosine === null ? null : toPercentage(cosine);
}

/**
 * Stage-2 fine-grained distance: chord distance derived from the weighted
 * micro cosine (0 = identical, ~2 = opposite). Null without micro vectors.
 */
function weightedMicroDistance(a, b, weights = MICRO_SPATIAL_WEIGHTS) {
  const cosine = weightedMicroCosine(a, b, weights);
  if (cosine === null) return null;
  const clamped = Math.max(-1, Math.min(1, cosine));
  return Math.round(Math.sqrt(Math.max(0, 2 * (1 - clamped))) * 10000) / 10000;
}

/**
 * High-precision confidence score (0–100) that differentiates lookalike /
 * twin animals: micro biometrics outweigh global body shape, and a gap
 * between a high global score and a lower micro score (the twin signature)
 * is amplified into an extra penalty. Species mismatch always scores 0.
 * A null microScore (legacy record without micro vectors) falls back to the
 * global score with no penalty for display, but the candidate can no longer
 * verify: passesStage2 requires a real micro comparison.
 */
function fineGrainedConfidence({ globalScore, microScore, speciesMatch }) {
  if (speciesMatch === false) return 0;
  const global = Number(globalScore);
  if (!Number.isFinite(global)) return 0;
  const micro = microScore === null || microScore === undefined ? global : Number(microScore);
  if (!Number.isFinite(micro)) return 0;
  let confidence = GLOBAL_CONFIDENCE_WEIGHT * global + MICRO_CONFIDENCE_WEIGHT * micro;
  if (global >= STAGE1_MIN_VISUAL && micro < global) {
    confidence -= (global - micro) * TWIN_GAP_PENALTY;
  }
  return Math.max(0, Math.min(100, Math.round(confidence * 100) / 100));
}

/**
 * Full 2-stage verification for one candidate. Strict biometric gate: a
 * candidate verifies ONLY when it passes stage 1 (species + global visual)
 * AND stage 2 (micro-biometric cutoff) AND the weighted confidence clears
 * the confidence threshold. Pure function over scores; exported for
 * focused testing.
 */
function cascadeMatch({ globalScore, microScore = null, sameSpecies }) {
  const speciesMatch = sameSpecies === true;
  const stage1Pass = passesStage1({ visual: globalScore, sameSpecies });
  const micro = microScore === null || microScore === undefined ? null : Number(microScore);
  const confidence = fineGrainedConfidence({ globalScore, microScore: micro, speciesMatch });
  const stage2Pass = passesStage2({ microScore: micro });
  return {
    stage1Score: Number(globalScore) || 0,
    stage2Score: micro,
    microScore: micro,
    stage1Pass,
    stage2Pass,
    speciesMatch,
    confidence,
    verified: stage1Pass && stage2Pass && confidence >= STAGE2_MIN_CONFIDENCE,
  };
}

module.exports = {
  cosineSimilarity,
  toPercentage,
  rankByScore,
  normalizeVector,
  passesStage1,
  passesStage2,
  splitMicroEmbedding,
  weightedMicroSimilarity,
  weightedMicroDistance,
  weightedMicroCosine,
  fineGrainedConfidence,
  cascadeMatch,
  STAGE1_MIN_VISUAL,
  STAGE2_MIN_MICRO,
  STAGE2_MIN_CONFIDENCE,
  MICRO_SPATIAL_WEIGHTS,
};
