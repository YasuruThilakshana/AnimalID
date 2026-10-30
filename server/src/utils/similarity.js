/**
 * High-precision cosine similarity helpers for comparing image embeddings.
 * Uses Kahan compensated summation so long vectors stay accurate.
 */

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

module.exports = { cosineSimilarity, toPercentage, rankByScore, normalizeVector };
