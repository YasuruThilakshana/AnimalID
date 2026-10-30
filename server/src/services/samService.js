const axios = require("axios");
const {
  extractLocalFeatures,
  extractFromCrop,
  prepareApiImage,
  EMBEDDING_DIM,
  EMBEDDING_VERSION,
  FACE_WEIGHT,
  MARKING_WEIGHT,
} = require("./imageFeatures");

const DEFAULT_SAM_API_URL = "https://api.meta.ai/v1";
const SAM_TIMEOUT_MS = 45000;
const SAM_CONCEPT = "animal";
const FALLBACK_SAMPLES = 2048;

/**
 * Meta AI SAM 3.1 service (Meta Model API, Responses protocol).
 *
 * The API key lives only in the backend .env (SAM_API_KEY) and is never sent
 * to the frontend. SAM_API_URL is the API base (default
 * https://api.meta.ai/v1); requests go to POST {base}/responses with
 * model "sam-3.1" and a concept prompt naming the animal. SAM returns a
 * bounding box (+ mask payload) per detected animal; the photo is cropped to
 * the largest box and weighted region features are extracted from the crop.
 *
 * When no key is configured, SAM finds no animal, or the API call fails, a
 * deterministic local segmentation + feature pipeline runs instead, so the
 * scanner keeps working in development.
 *
 * A custom embeddings endpoint (any SAM_API_URL that is not the /v1 base) is
 * still supported via the legacy { embedding } / { regions } JSON shape.
 */
let lastEngine = "sam-3.1";

/** Legacy single-vector entry point (embedding only). */
async function getImageEmbedding(buffer, mimeType = "image/jpeg") {
  return (await extractAnimalFeatures(buffer, mimeType)).embedding;
}

function getEmbeddingEngine() {
  return lastEngine;
}

/**
 * Full feature extraction: SAM-guided background removal + weighted
 * multi-region embedding. Returns { embedding, localEmbedding, segmentation,
 * regions, version, engine }.
 *
 * `embedding` is the primary (SAM-guided when the API answers) vector, while
 * `localEmbedding` is ALWAYS the deterministic API-free vector for the same
 * bytes. Storing and comparing both guarantees identical images score 100%
 * even if SAM answers on one side and falls back on the other.
 */
async function extractAnimalFeatures(buffer, mimeType = "image/jpeg", concept = SAM_CONCEPT) {
  const input = toBuffer(buffer);
  if (!input || input.length === 0) {
    throw new Error("Cannot embed an empty image buffer.");
  }

  const apiKey = (process.env.SAM_API_KEY || "").trim();
  const apiUrl = (process.env.SAM_API_URL || "").trim() || DEFAULT_SAM_API_URL;
  if (apiKey) {
    const remote = await fetchSamFeatures(apiUrl, apiKey, input, mimeType, concept);
    if (remote) {
      lastEngine = "sam-3.1";
      const deterministic = extractLocalFeatures(input, mimeType);
      return {
        ...remote,
        localEmbedding: deterministic.embedding,
        engine: lastEngine,
        version: EMBEDDING_VERSION,
      };
    }
  }
  const local = extractLocalFeatures(input, mimeType);
  lastEngine = local.segmentation.method === "bytes" ? "sam-3.1-bytes" : "sam-3.1-local";
  return { ...local, localEmbedding: local.embedding, regions: true, engine: lastEngine };
}

/** Route to the Responses API or a legacy custom embeddings endpoint. */
async function fetchSamFeatures(apiUrl, apiKey, buffer, mimeType, concept) {
  if (!isResponsesEndpoint(apiUrl)) {
    return fetchLegacyEmbedding(apiUrl, apiKey, buffer, mimeType);
  }
  try {
    const { dataUrl } = prepareApiImage(buffer, mimeType);
    const response = await axios.post(
      joinUrl(apiUrl, "responses"),
      {
        model: "sam-3.1",
        stream: false,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: concept },
              { type: "input_image", image_url: dataUrl },
            ],
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: SAM_TIMEOUT_MS,
      },
    );
    const text = extractOutputText(response.data);
    const boxes = parseSamBoxes(text);
    if (!boxes.length) {
      console.warn("[sam] no animal detected by SAM 3.1; using local segmentation.");
      return null;
    }
    const box = largestBox(boxes);
    const cropped = extractFromCrop(buffer, mimeType, box);
    return {
      embedding: cropped.embedding,
      segmentation: {
        applied: true,
        method: "sam-3.1",
        fgFraction: cropped.segmentation.fgFraction,
        bbox: { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 },
        boxesFound: boxes.length,
      },
      regions: true,
    };
  } catch (err) {
    const detail = err?.response?.data?.error || err.message;
    console.warn("[sam] API call failed, using local fallback pipeline:", detail);
    return null;
  }
}

function isResponsesEndpoint(apiUrl) {
  return /\/v1\/?$/.test(apiUrl) || /\/responses\/?$/.test(apiUrl);
}

function joinUrl(base, path) {
  const trimmed = String(base).replace(/\/+$/, "");
  if (trimmed.endsWith(`/${path}`)) return trimmed;
  return `${trimmed}/${path}`;
}

/** Pull the output text out of Responses / chat-style payloads. */
function extractOutputText(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload.output_text === "string") return payload.output_text;
  if (Array.isArray(payload.output)) {
    const chunks = [];
    for (const item of payload.output) {
      for (const part of item?.content || []) {
        if (typeof part?.text === "string") chunks.push(part.text);
      }
      if (typeof item?.text === "string") chunks.push(item.text);
    }
    if (chunks.length) return chunks.join("");
  }
  const choice = payload.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  if (Array.isArray(choice)) {
    return choice.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  }
  return "";
}

/**
 * Parse SAM box records:
 * `<|box;x1=444;y1=625;x2=679;y2=850;w=1800;h=1200|>`
 */
function parseSamBoxes(text) {
  const boxes = [];
  if (!text) return boxes;
  const re = /<\|box;x1=([\d.]+);y1=([\d.]+);x2=([\d.]+);y2=([\d.]+);w=([\d.]+);h=([\d.]+)\|>/g;
  let match = re.exec(text);
  while (match) {
    const [x1, y1, x2, y2, w, h] = match.slice(1, 7).map(Number);
    if ([x1, y1, x2, y2, w, h].every(Number.isFinite) && w > 0 && h > 0 && x2 > x1 && y2 > y1) {
      boxes.push({ x1, y1, x2, y2, w, h });
    }
    match = re.exec(text);
  }
  return boxes;
}

/** Largest-area box = the main animal subject. */
function largestBox(boxes) {
  return boxes.reduce((best, box) => {
    const area = (box.x2 - box.x1) * (box.y2 - box.y1);
    const bestArea = (best.x2 - best.x1) * (best.y2 - best.y1);
    return area > bestArea ? box : best;
  });
}

/**
 * Legacy custom embeddings endpoint: POST { model, tasks, image } and parse
 * { embedding } / { regions } / { data } JSON shapes.
 */
async function fetchLegacyEmbedding(apiUrl, apiKey, buffer, mimeType) {
  try {
    const response = await axios.post(
      apiUrl,
      {
        model: "sam-3.1",
        tasks: ["segment", "embed"],
        input_type: "image",
        mimeType,
        image: buffer.toString("base64"),
        options: {
          remove_background: true,
          weighted_regions: ["face", "markings", "body", "contour"],
          face_weight: FACE_WEIGHT,
          marking_weight: MARKING_WEIGHT,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: SAM_TIMEOUT_MS,
      },
    );
    const data = response.data || {};
    const regionVectors = extractRegionVectors(data);
    const fused = regionVectors ? fuseRegionVectors(regionVectors) : null;
    const vector = fused || extractVector(data);
    if (!vector) {
      throw new Error("SAM API response did not contain an embedding vector");
    }
    const mask = extractMask(data);
    return {
      embedding: normalize(resizeVector(vector, EMBEDDING_DIM)),
      segmentation: {
        applied: Boolean(mask || data.background_removed !== false),
        method: "sam-3.1",
        fgFraction: mask ? mask.fgFraction : null,
        bbox: mask ? mask.bbox : null,
      },
      regions: Boolean(regionVectors),
    };
  } catch (err) {
    const detail = err?.response?.data?.error || err.message;
    console.warn("[sam] API call failed, using local fallback pipeline:", detail);
    return null;
  }
}

/** Pull per-region feature vectors (face/markings/...) out of a SAM response. */
function extractRegionVectors(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const holder = payload.regions || payload.region_features || payload.regionFeatures;
  if (!holder || typeof holder !== "object" || Array.isArray(holder)) return null;
  const out = {};
  for (const [name, value] of Object.entries(holder)) {
    const vector = coerceNumbers(value);
    if (vector) out[String(name).toLowerCase()] = vector;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Fuse per-region vectors into one identity vector. Face and markings count
 * most so lookalikes with different faces or markings stay separated.
 */
function fuseRegionVectors(regions) {
  const weights = {
    face: FACE_WEIGHT,
    facial: FACE_WEIGHT,
    head: FACE_WEIGHT,
    markings: MARKING_WEIGHT,
    marks: MARKING_WEIGHT,
    spots: MARKING_WEIGHT,
    pattern: MARKING_WEIGHT,
  };
  let dim = 0;
  for (const v of Object.values(regions)) dim = Math.max(dim, v.length);
  if (!dim) return null;
  const fused = new Array(dim).fill(0);
  let totalWeight = 0;
  for (const [name, vector] of Object.entries(regions)) {
    const weight = weights[name] !== undefined ? weights[name] : 1.0;
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
    for (let i = 0; i < dim; i++) {
      fused[i] += weight * (Number(vector[i % vector.length]) / norm);
    }
    totalWeight += weight;
  }
  if (!totalWeight) return null;
  return normalize(fused.map((v) => v / totalWeight));
}

/** Extract a subject mask ({ data, width, height }) when the API returns one. */
function extractMask(payload) {
  const mask = payload.mask || payload.segmentation_mask || payload.segmentationMask;
  if (!mask) return null;
  const data = Array.isArray(mask) ? mask : mask.data;
  const width = Number(mask.width) || 0;
  const height = Number(mask.height) || 0;
  if (!Array.isArray(data) || !data.length || !width || !height) return null;
  let fg = 0;
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < Math.min(data.length, width * height); i++) {
    if (!data[i]) continue;
    fg += 1;
    const x = i % width;
    const y = Math.floor(i / width);
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { fgFraction: fg / (width * height), bbox: fg ? { x0, y0, x1, y1 } : null };
}

/**
 * Deeply extract a numeric feature vector from the many shapes an embedding
 * API may return: { embedding }, { vector }, { features }, { data }, nested
 * { data: { embedding } }, 2D single-row matrices, or a bare array.
 */
function extractVector(payload) {
  if (Array.isArray(payload)) return coerceNumbers(payload);
  if (!payload || typeof payload !== "object") return null;

  const candidates = [
    payload.embedding,
    payload.vector,
    payload.features,
    payload.feature_vector,
    payload.output,
    payload.embeddings,
    payload.data,
  ];
  for (const candidate of candidates) {
    const vector = coerceNumbers(candidate);
    if (vector) return vector;
    // One level of nesting, e.g. { data: { embedding: [...] } }.
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const nested = extractVector(candidate);
      if (nested) return nested;
    }
  }
  return null;
}

/** Accept a flat numeric array (or single-row 2D matrix); else null. */
function coerceNumbers(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  let flat = value;
  // Mean-pool a 2D matrix (e.g. patch tokens) into one vector.
  if (Array.isArray(flat[0])) {
    const rows = flat.filter((r) => Array.isArray(r) && r.length > 0);
    if (!rows.length) return null;
    const width = Math.min(...rows.map((r) => r.length));
    if (!width) return null;
    flat = rows[0].slice(0, width).map((_, col) => {
      let sum = 0;
      for (const row of rows) sum += Number(row[col]);
      return sum / rows.length;
    });
  }
  if (!flat.every((v) => Number.isFinite(Number(v)))) return null;
  return flat.map(Number);
}

/** Pad (repeat) or truncate a vector to the target dimension. */
function resizeVector(vector, dim) {
  if (vector.length === dim) return vector;
  if (vector.length > dim) return vector.slice(0, dim);
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) out[i] = vector[i % vector.length];
  return out;
}

/**
 * Legacy deterministic byte-level embedding (feature space v1, kept for
 * backward compatibility). New extractions use the segmentation pipeline.
 */
function localEmbedding(buffer) {
  const input = toBuffer(buffer);
  const samples = new Array(FALLBACK_SAMPLES);
  let mean = 0;
  for (let j = 0; j < FALLBACK_SAMPLES; j++) {
    const byte = input[Math.floor((j / FALLBACK_SAMPLES) * input.length)];
    samples[j] = byte / 255 - 0.5;
    mean += samples[j];
  }
  mean /= FALLBACK_SAMPLES;
  for (let j = 0; j < FALLBACK_SAMPLES; j++) samples[j] -= mean;
  const rand = mulberry32(0x3a1f7d29);
  const vector = new Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    let sum = 0;
    for (let j = 0; j < FALLBACK_SAMPLES; j++) {
      sum += (rand() * 2 - 1) * samples[j];
    }
    vector[i] = sum / Math.sqrt(FALLBACK_SAMPLES);
  }
  return normalize(vector);
}

/** Seeded PRNG so the fallback projection matrix is stable across restarts. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toBuffer(value) {
  if (!value) return Buffer.alloc(0);
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value));
}

function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (!norm) return vector;
  return vector.map((v) => v / norm);
}

module.exports = {
  getImageEmbedding,
  extractAnimalFeatures,
  getEmbeddingEngine,
  extractOutputText,
  parseSamBoxes,
  extractVector,
  extractRegionVectors,
  fuseRegionVectors,
  localEmbedding,
  EMBEDDING_DIM,
  EMBEDDING_VERSION,
};
