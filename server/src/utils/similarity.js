/**
 * Cosine similarity helpers for comparing image embeddings.
 * Returns a 0–100 match percentage.
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function toPercentage(similarity) {
  const clamped = Math.max(-1, Math.min(1, similarity));
  return Math.round(clamped * 10000) / 100;
}

module.exports = { cosineSimilarity, toPercentage };
