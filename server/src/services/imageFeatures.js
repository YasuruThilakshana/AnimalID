const crypto = require("crypto");
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");

const EMBEDDING_VERSION = 2;
const EMBEDDING_DIM = 128;
const WORK_SIZE = 64;
const REGION_DIM = 24;
const DESCRIPTOR_DIM = REGION_DIM * 4;

// Facial structure and unique markings drive identity: weight them higher so
// two animals sharing a coat color but differing in face/markings stay apart.
const FACE_WEIGHT = 2.0;
const MARKING_WEIGHT = 1.5;
const BODY_WEIGHT = 1.0;
const CONTOUR_WEIGHT = 1.0;
const PROJECTION_SEED = 0x5bd1e995;

/**
 * Local segmentation + multi-region feature extraction.
 *
 * Pipeline: decode → isolate the animal from the background (border-sampled
 * background model + center prior + largest-component cleanup) → describe
 * face / markings / body / contour regions inside the subject bounding box →
 * weighted fusion → fixed random projection → L2-normalized embedding.
 */
function extractLocalFeatures(buffer, mimeType = "image/jpeg") {
  const input = toBuffer(buffer);
  if (!input || input.length === 0) {
    throw new Error("Cannot analyze an empty image buffer.");
  }
  const decoded = decodeImage(input, mimeType);
  if (!decoded) {
    // Unsupported codec (e.g. webp/gif): deterministic byte-level descriptor
    // in the same projection space. Identical files still match at 100%.
    return {
      embedding: projectToEmbedding(bytesDescriptor(input)),
      segmentation: { applied: false, method: "bytes", fgFraction: 1, bbox: null },
      version: EMBEDDING_VERSION,
    };
  }
  return featuresFromGrid(toGrid(decoded, WORK_SIZE), "local");
}

/**
 * SAM-guided extraction: crop the decoded photo to a SAM 3.1 box (given in
 * the pixels of the image sent to the API, via box.w/box.h) and extract
 * weighted region features from the crop. Falls back to full-frame local
 * features when the box is unusable.
 */
function extractFromCrop(buffer, mimeType, box) {
  const input = toBuffer(buffer);
  if (!input || input.length === 0) {
    throw new Error("Cannot analyze an empty image buffer.");
  }
  const decoded = decodeImage(input, mimeType);
  if (!decoded) {
    return {
      embedding: projectToEmbedding(bytesDescriptor(input)),
      segmentation: { applied: false, method: "bytes", fgFraction: 1, bbox: null },
      version: EMBEDDING_VERSION,
    };
  }
  const grid = toGrid(decoded, WORK_SIZE);
  const cropped = box ? cropGridToBox(grid, box) : null;
  const result = featuresFromGrid(cropped || grid, cropped ? "sam-3.1-box" : "local");
  if (cropped) {
    result.segmentation.applied = true;
    result.segmentation.samBox = {
      x1: box.x1,
      y1: box.y1,
      x2: box.x2,
      y2: box.y2,
    };
  }
  return result;
}

function featuresFromGrid(grid, method) {
  const seg = segmentSubject(grid);
  const descriptor = describeSubject(grid, seg);
  return {
    embedding: projectToEmbedding(descriptor),
    segmentation: {
      applied: seg.applied,
      method,
      fgFraction: Math.round(seg.fraction * 1000) / 1000,
      bbox: seg.bbox,
    },
    version: EMBEDDING_VERSION,
  };
}

/**
 * Prepare an upload for the SAM API: downscale large photos to a 1024px
 * bounding box (PNG data URL) so requests stay fast and under payload
 * limits. Returns { dataUrl, width, height } in SENT-image pixels.
 */
function prepareApiImage(buffer, mimeType = "image/jpeg") {
  const input = toBuffer(buffer);
  const decoded = decodeImage(input, mimeType);
  const fallback = {
    dataUrl: `data:${mimeType || "image/jpeg"};base64,${input.toString("base64")}`,
    width: decoded ? decoded.w : 0,
    height: decoded ? decoded.h : 0,
  };
  if (!decoded) return fallback;
  const longest = Math.max(decoded.w, decoded.h);
  if (longest <= 1024) return fallback;
  const scale = 1024 / longest;
  const width = Math.max(1, Math.round(decoded.w * scale));
  const height = Math.max(1, Math.round(decoded.h * scale));
  const out = new PNG({ width, height });
  const { w, h, data, channels } = decoded;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(h - 1, Math.floor((y / height) * h));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(w - 1, Math.floor((x / width) * w));
      const p = (sy * w + sx) * channels;
      const o = (y * width + x) * 4;
      if (channels === 1) {
        out.data[o] = out.data[o + 1] = out.data[o + 2] = data[p];
        out.data[o + 3] = 255;
      } else {
        out.data[o] = data[p];
        out.data[o + 1] = data[p + 1];
        out.data[o + 2] = data[p + 2];
        out.data[o + 3] = channels === 4 ? data[p + 3] : 255;
      }
    }
  }
  return {
    dataUrl: `data:image/png;base64,${PNG.sync.write(out).toString("base64")}`,
    width,
    height,
  };
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

function decodeImage(input, mimeType) {
  const looksPng = input[0] === 0x89 && input[1] === 0x50 && input[2] === 0x4e && input[3] === 0x47;
  const looksJpeg = input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
  const wantsPng = String(mimeType || "").includes("png");
  const order = looksPng || (!looksJpeg && wantsPng) ? ["png", "jpeg"] : ["jpeg", "png"];
  for (const kind of order) {
    try {
      if (kind === "png") {
        const img = PNG.sync.read(Buffer.from(input));
        return normalizeDecoded(img.width, img.height, img.data);
      }
      const img = jpeg.decode(Buffer.from(input), { maxMemoryUsageInMB: 512, maxResolutionInMP: 24 });
      return normalizeDecoded(img.width, img.height, img.data);
    } catch {
      // Try the next codec.
    }
  }
  return null;
}

function normalizeDecoded(w, h, data) {
  if (!w || !h || !data || data.length < w * h) return null;
  const channels = Math.round(data.length / (w * h));
  if (![1, 3, 4].includes(channels)) return null;
  return { w, h, data, channels };
}

function toGrid(decoded, size) {
  const { w, h, data, channels } = decoded;
  const n = size * size;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const a = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(h - 1, Math.floor((y / size) * h));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(w - 1, Math.floor((x / size) * w));
      const p = (sy * w + sx) * channels;
      const o = y * size + x;
      if (channels === 1) {
        r[o] = g[o] = b[o] = data[p];
        a[o] = 255;
      } else {
        r[o] = data[p];
        g[o] = data[p + 1];
        b[o] = data[p + 2];
        a[o] = channels === 4 ? data[p + 3] : 255;
      }
    }
  }
  return { size, r, g, b, a };
}

// ---------------------------------------------------------------------------
// Segmentation: isolate the animal, drop grass/cages/hands/trees.
// ---------------------------------------------------------------------------

function segmentSubject(grid) {
  const { size } = grid;
  const bg = estimateBackground(grid);
  const mask = new Uint8Array(size * size);
  const sigma = 0.42;
  for (let y = 0; y < size; y++) {
    const ny = (y / (size - 1)) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const o = y * size + x;
      if (grid.a[o] < 128) continue; // transparent => background
      const nx = (x / (size - 1)) * 2 - 1;
      const d =
        Math.sqrt(
          (grid.r[o] - bg[0]) ** 2 + (grid.g[o] - bg[1]) ** 2 + (grid.b[o] - bg[2]) ** 2,
        ) / 441.673;
      const fg = clamp((d - 0.05) / 0.22, 0, 1);
      const prior = 0.3 + 0.7 * Math.exp(-(nx * nx + ny * ny) / (2 * sigma * sigma));
      if (fg * prior > 0.28) mask[o] = 1;
    }
  }
  const cleaned = largestComponent(mask, size);
  if (cleaned.fraction >= 0.04 && cleaned.fraction <= 0.96) {
    return { ...cleaned, applied: true };
  }
  // No coherent subject found — fall back to the full frame.
  return {
    mask: new Uint8Array(size * size).fill(1),
    bbox: { x0: 0, y0: 0, x1: size - 1, y1: size - 1 },
    fraction: 1,
    applied: false,
  };
}

/** Background color = median of the border cells (animals rarely touch edges). */
function estimateBackground(grid) {
  const { size } = grid;
  const pick = (o) => [grid.r[o], grid.g[o], grid.b[o]];
  const samples = [];
  for (let x = 0; x < size; x++) {
    samples.push(pick(x), pick((size - 1) * size + x));
  }
  for (let y = 1; y < size - 1; y++) {
    samples.push(pick(y * size), pick(y * size + size - 1));
  }
  const median = (vals) => {
    const s = [...vals].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  };
  return [0, 1, 2].map((c) => median(samples.map((px) => px[c])));
}

/** Keep only the largest connected foreground blob; drop speckles/hands. */
function largestComponent(mask, size) {
  const seen = new Uint8Array(size * size);
  let best = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    const cells = [];
    while (stack.length) {
      const o = stack.pop();
      cells.push(o);
      const x = o % size;
      const y = Math.floor(o / size);
      const neighbors = [
        x > 0 ? o - 1 : -1,
        x < size - 1 ? o + 1 : -1,
        y > 0 ? o - size : -1,
        y < size - 1 ? o + size : -1,
      ];
      for (const nb of neighbors) {
        if (nb >= 0 && mask[nb] && !seen[nb]) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    if (cells.length > best.length) best = cells;
  }
  if (!best.length) {
    return {
      mask: new Uint8Array(size * size),
      bbox: { x0: 0, y0: 0, x1: size - 1, y1: size - 1 },
      fraction: 0,
    };
  }
  const out = new Uint8Array(size * size);
  let x0 = size;
  let y0 = size;
  let x1 = 0;
  let y1 = 0;
  for (const o of best) {
    out[o] = 1;
    const x = o % size;
    const y = Math.floor(o / size);
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  // Pad the bounding box by one cell so edges are not clipped.
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(size - 1, x1 + 1);
  y1 = Math.min(size - 1, y1 + 1);
  return { mask: out, bbox: { x0, y0, x1, y1 }, fraction: best.length / (size * size) };
}

/**
 * Crop a working grid to a SAM box. The box is expressed in sent-image
 * pixels; it maps to grid cells by fraction, so API-side resizing is safe.
 * Returns a new square grid, or null when the box is unusable.
 */
function cropGridToBox(grid, box) {
  const { size } = grid;
  const w = Number(box && box.w);
  const h = Number(box && box.h);
  if (!w || !h) return null;
  let x0 = Math.floor((Number(box.x1) / w) * size);
  let y0 = Math.floor((Number(box.y1) / h) * size);
  let x1 = Math.ceil((Number(box.x2) / w) * size);
  let y1 = Math.ceil((Number(box.y2) / h) * size);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  // Pad slightly so the subject edge is never clipped.
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(size - 1, x1 + 1);
  y1 = Math.min(size - 1, y1 + 1);
  // Expand to a square.
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  if (bw < 4 || bh < 4) return null;
  const side = Math.min(size, Math.max(bw, bh));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  x0 = clamp(Math.round(cx - side / 2), 0, size - side);
  y0 = clamp(Math.round(cy - side / 2), 0, size - side);
  const out = {
    size: side,
    r: new Float32Array(side * side),
    g: new Float32Array(side * side),
    b: new Float32Array(side * side),
    a: new Float32Array(side * side),
  };
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const src = (y0 + y) * size + (x0 + x);
      const dst = y * side + x;
      out.r[dst] = grid.r[src];
      out.g[dst] = grid.g[src];
      out.b[dst] = grid.b[src];
      out.a[dst] = grid.a[src];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Region descriptors: face, markings, body, contour.
// ---------------------------------------------------------------------------

function describeSubject(grid, seg) {
  const { size } = grid;
  const lum = new Float32Array(size * size);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = 0.299 * grid.r[i] + 0.587 * grid.g[i] + 0.114 * grid.b[i];
  }
  const { mag, ori } = sobel(lum, size);
  const { bbox } = seg;
  const inMask = (o) => seg.mask[o] === 1;

  const body = [];
  for (let y = bbox.y0; y <= bbox.y1; y++) {
    for (let x = bbox.x0; x <= bbox.x1; x++) {
      const o = y * size + x;
      if (inMask(o)) body.push(o);
    }
  }
  const cells = body.length ? body : allCells(size);
  const meanLum = cells.reduce((s, o) => s + lum[o], 0) / cells.length;

  const bw = Math.max(1, bbox.x1 - bbox.x0 + 1);
  const bh = Math.max(1, bbox.y1 - bbox.y0 + 1);
  const faceY1 = bbox.y0 + Math.floor(bh * 0.42);
  const faceX0 = bbox.x0 + Math.floor(bw * 0.19);
  const faceX1 = bbox.x1 - Math.floor(bw * 0.19);
  const face = cells.filter((o) => {
    const x = o % size;
    const y = Math.floor(o / size);
    return y <= faceY1 && x >= faceX0 && x <= faceX1;
  });

  const markings = cells.filter((o) => {
    const mx = Math.max(grid.r[o], grid.g[o], grid.b[o]);
    const mn = Math.min(grid.r[o], grid.g[o], grid.b[o]);
    const sat = (mx - mn) / (mx + 1e-6);
    return sat > 0.22 || Math.abs(lum[o] - meanLum) > 22;
  });

  const contour = cells.filter((o) => mag[o] > 18);

  const ctx = { grid, lum, mag, ori };
  const parts = [
    scale(describeCells(ctx, face.length >= 12 ? face : cells), FACE_WEIGHT),
    scale(describeCells(ctx, markings.length >= 12 ? markings : cells), MARKING_WEIGHT),
    scale(describeCells(ctx, cells), BODY_WEIGHT),
    scale(describeCells(ctx, contour.length >= 12 ? contour : cells), CONTOUR_WEIGHT),
  ];
  return parts.flat();
}

/** 24-d descriptor: gray hist (8) + mean/std RGB (6) + saturation (1) + orientation hist (8) + edge density (1). */
function describeCells(ctx, cells) {
  const { grid, lum, mag, ori } = ctx;
  const desc = new Array(REGION_DIM).fill(0);
  if (!cells.length) return desc;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let ssat = 0;
  let edge = 0;
  const hist = new Array(8).fill(0);
  const ohist = new Array(8).fill(0);
  let omag = 0;
  for (const o of cells) {
    const v = clamp(Math.floor(lum[o] / 32), 0, 7);
    hist[v] += 1;
    sr += grid.r[o];
    sg += grid.g[o];
    sb += grid.b[o];
    const mx = Math.max(grid.r[o], grid.g[o], grid.b[o]);
    const mn = Math.min(grid.r[o], grid.g[o], grid.b[o]);
    ssat += (mx - mn) / (mx + 1e-6);
    ohist[ori[o]] += mag[o];
    omag += mag[o];
    if (mag[o] > 18) edge += 1;
  }
  const n = cells.length;
  const mr = sr / n;
  const mg = sg / n;
  const mb = sb / n;
  let vr = 0;
  let vg = 0;
  let vb = 0;
  for (const o of cells) {
    vr += (grid.r[o] - mr) ** 2;
    vg += (grid.g[o] - mg) ** 2;
    vb += (grid.b[o] - mb) ** 2;
  }
  for (let i = 0; i < 8; i++) desc[i] = hist[i] / n;
  desc[8] = mr / 255;
  desc[9] = mg / 255;
  desc[10] = mb / 255;
  desc[11] = Math.sqrt(vr / n) / 255;
  desc[12] = Math.sqrt(vg / n) / 255;
  desc[13] = Math.sqrt(vb / n) / 255;
  desc[14] = ssat / n;
  for (let i = 0; i < 8; i++) desc[15 + i] = omag > 0 ? ohist[i] / omag : 0;
  desc[23] = edge / n;
  return desc;
}

function sobel(lum, size) {
  const mag = new Float32Array(size * size);
  const ori = new Uint8Array(size * size);
  const at = (x, y) => lum[y * size + x];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const o = y * size + x;
      mag[o] = Math.abs(gx) + Math.abs(gy);
      let bin = Math.floor(((Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI)) * 8);
      ori[o] = clamp(bin, 0, 7);
    }
  }
  return { mag, ori };
}

// ---------------------------------------------------------------------------
// Weighted fusion → fixed projection → normalized embedding.
// ---------------------------------------------------------------------------

let projectionMatrix = null;

function getProjection() {
  if (projectionMatrix) return projectionMatrix;
  const rand = mulberry32(PROJECTION_SEED);
  // Box-Muller gaussian entries.
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  projectionMatrix = [];
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const row = new Array(DESCRIPTOR_DIM);
    for (let j = 0; j < DESCRIPTOR_DIM; j++) row[j] = gauss();
    projectionMatrix.push(row);
  }
  return projectionMatrix;
}

function projectToEmbedding(descriptor) {
  const matrix = getProjection();
  // Center the descriptor: raw visual features are all non-negative, and that
  // shared DC offset would inflate every cosine score. Centering keeps true
  // matches high while pushing unrelated animals well below threshold.
  const mean = descriptor.reduce((s, v) => s + v, 0) / descriptor.length;
  const centered = descriptor.map((v) => v - mean);
  const scale = 1 / Math.sqrt(DESCRIPTOR_DIM);
  const out = new Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    let sum = 0;
    const row = matrix[i];
    for (let j = 0; j < DESCRIPTOR_DIM; j++) sum += row[j] * centered[j];
    out[i] = sum * scale;
  }
  return normalize(out);
}

/** Deterministic descriptor for undecodable images (same bytes => same vector). */
function bytesDescriptor(input) {
  const desc = new Array(DESCRIPTOR_DIM);
  for (let i = 0; i < DESCRIPTOR_DIM; i++) {
    const h = crypto.createHash("sha256").update(input).update(String(i)).digest();
    desc[i] = h.readInt32BE((i * 7) % 28) / 2147483648;
  }
  return desc;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scale(vector, weight) {
  return vector.map((v) => v * weight);
}

function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (!norm) return vector;
  return vector.map((v) => v / norm);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function allCells(size) {
  const cells = new Array(size * size);
  for (let i = 0; i < cells.length; i++) cells[i] = i;
  return cells;
}

function toBuffer(value) {
  if (!value) return Buffer.alloc(0);
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value));
}

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

module.exports = {
  extractLocalFeatures,
  extractFromCrop,
  prepareApiImage,
  projectToEmbedding,
  EMBEDDING_VERSION,
  EMBEDDING_DIM,
  FACE_WEIGHT,
  MARKING_WEIGHT,
};
