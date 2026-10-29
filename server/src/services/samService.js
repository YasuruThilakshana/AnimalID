const axios = require("axios");
const crypto = require("crypto");

const EMBEDDING_DIM = 128;

/**
 * Meta AI SAM 3.1 embedding service.
 *
 * The API key lives only in the backend .env (SAM_API_KEY) and is never sent
 * to the frontend. When no key is configured or the API call fails, a
 * deterministic local embedding is generated from the image bytes so the
 * scanner keeps working in development.
 */
async function getImageEmbedding(buffer, mimeType = "image/jpeg") {
  const apiKey = process.env.SAM_API_KEY;
  const apiUrl = process.env.SAM_API_URL;
  if (apiKey && apiUrl) {
    try {
      const response = await axios.post(
        apiUrl,
        { image: buffer.toString("base64"), mimeType },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        },
      );
      const data = response.data || {};
      const vector = data.embedding || data.vector || data.features || data.data;
      if (Array.isArray(vector) && vector.length > 0) {
        return normalize(vector.map(Number));
      }
      throw new Error("SAM API response did not contain an embedding vector");
    } catch (err) {
      console.warn("[sam] API call failed, using local fallback embedding:", err.message);
    }
  }
  return localEmbedding(buffer);
}

/** Deterministic, normalized pseudo-embedding derived from image bytes. */
function localEmbedding(buffer) {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer));
  const blocks = Math.max(1, Math.floor(input.length / 32));
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const start = Math.floor((i / EMBEDDING_DIM) * input.length);
    const slice = input.subarray(start, Math.min(start + 64, input.length));
    const hash = crypto
      .createHash("sha256")
      .update(slice)
      .update(String(i))
      .update(String(blocks))
      .digest();
    vector[i] = hash.readInt32BE((i * 7) % 28) / 2147483648;
  }
  return normalize(vector);
}

function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (!norm) return vector;
  return vector.map((v) => v / norm);
}

module.exports = { getImageEmbedding, EMBEDDING_DIM };
