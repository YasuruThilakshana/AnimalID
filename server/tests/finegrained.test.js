const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const {
  cosineSimilarity,
  toPercentage,
  passesStage1,
  weightedMicroSimilarity,
  fineGrainedConfidence,
  cascadeMatch,
  STAGE1_MIN_VISUAL,
  MICRO_SPATIAL_WEIGHTS,
} = require("../src/utils/similarity");
const {
  extractAnimalFeatures,
  extractMultiCropEmbeddings,
  buildFineGrainedVector,
  BIOMETRIC_REGIONS,
  MICRO_EMBEDDING_DIM,
} = require("../src/services/samService");

/** Same synthetic-animal generator style as scan.test.js (seed = identity). */
function syntheticPNG(seed, bg = [70, 130, 60]) {
  const W = 96;
  const H = 96;
  const png = new PNG({ width: W, height: H });
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) / 16777216;
  };
  const coats = [
    [150, 100, 60],
    [70, 70, 85],
    [190, 170, 130],
  ];
  const coat = coats[seed % coats.length];
  const ax = 0.24 + (seed % 5) * 0.025;
  const ay = 0.3 + (seed % 3) * 0.04;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let r = bg[0] + rnd() * 30;
      let g = bg[1] + rnd() * 40;
      let b = bg[2] + rnd() * 25;
      const dx = (x - W / 2) / (W * ax);
      const dy = (y - H / 2) / (H * ay);
      if (dx * dx + dy * dy < 1) {
        r = coat[0] + rnd() * 35;
        g = coat[1] + rnd() * 30;
        b = coat[2] + rnd() * 25;
        if (Math.sin(x * (0.5 + (seed % 4) * 0.2) + seed) * Math.cos(y * 0.9) > 0.55) {
          r = coat[0] * 0.25;
          g = coat[1] * 0.25;
          b = coat[2] * 0.3;
        }
      }
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe("multi-crop micro-feature embeddings", () => {
  it("extracts global + 4 biometric region crops fused into one normalized vector", async () => {
    assert.deepEqual([...BIOMETRIC_REGIONS].sort(), ["coat_markings", "ear_pattern", "facial_mask", "muzzle"]);
    assert.ok(MICRO_EMBEDDING_DIM > 128, "micro vector must be high-dimensional");

    const features = await extractAnimalFeatures(syntheticPNG(7), "image/png");
    assert.ok(Array.isArray(features.embedding) && features.embedding.length === 128);
    assert.ok(Array.isArray(features.globalEmbedding), "global embedding alias");
    assert.deepEqual(features.globalEmbedding, features.embedding);
    assert.ok(Array.isArray(features.microEmbedding), "micro biometric vector");
    assert.equal(features.microEmbedding.length, MICRO_EMBEDDING_DIM);
    assert.ok(Math.abs(norm(features.microEmbedding) - 1) < 1e-6, "micro vector is L2-normalized");
    for (const region of BIOMETRIC_REGIONS) {
      assert.ok(
        Array.isArray(features.regionEmbeddings?.[region]) && features.regionEmbeddings[region].length > 0,
        `region crop present: ${region}`,
      );
    }
  });

  it("scores identical bytes 100% on micro features and separates identities", async () => {
    const a = await extractAnimalFeatures(syntheticPNG(7), "image/png");
    const same = await extractAnimalFeatures(syntheticPNG(7), "image/png");
    const other = await extractAnimalFeatures(syntheticPNG(99), "image/png");
    assert.equal(toPercentage(cosineSimilarity(a.microEmbedding, same.microEmbedding)), 100);
    const stranger = toPercentage(cosineSimilarity(a.microEmbedding, other.microEmbedding));
    assert.ok(stranger < 100, `unrelated micro ${stranger}% must rank below identical 100%`);
  });

  it("concatenates + normalizes region crops via buildFineGrainedVector", async () => {
    const { regionEmbeddings } = await extractMultiCropEmbeddings(syntheticPNG(7), "image/png");
    const fused = buildFineGrainedVector(regionEmbeddings);
    assert.equal(fused.length, MICRO_EMBEDDING_DIM);
    assert.ok(Math.abs(norm(fused) - 1) < 1e-6, "fused vector is L2-normalized");
  });
});

describe("cascade matching", () => {
  it("stage 1 passes strictly on same species AND visual > 85%", () => {
    assert.equal(STAGE1_MIN_VISUAL, 85);
    assert.equal(passesStage1({ visual: 92.5, sameSpecies: true }), true);
    assert.equal(passesStage1({ visual: 85, sameSpecies: true }), false);
    assert.equal(passesStage1({ visual: 84.99, sameSpecies: true }), false);
    assert.equal(passesStage1({ visual: 99, sameSpecies: false }), false);
  });

  it("weights unique biometric textures over general coat/body regions", () => {
    assert.ok(MICRO_SPATIAL_WEIGHTS.muzzle > MICRO_SPATIAL_WEIGHTS.coat_markings);
    assert.ok(MICRO_SPATIAL_WEIGHTS.facial_mask > MICRO_SPATIAL_WEIGHTS.coat_markings);
    const slice = (v) => [v, v * 0.5 + 0.5, v * 0.25 + 0.75, v * 0.1 + 0.9];
    const base = [...slice(0.6), ...slice(0.6), ...slice(0.6), ...slice(0.6)];
    const muzzleShift = [...slice(-0.6), ...slice(0.6), ...slice(0.6), ...slice(0.6)];
    const coatShift = [...slice(0.6), ...slice(0.6), ...slice(0.6), ...slice(-0.6)];
    const order = [...BIOMETRIC_REGIONS];
    const muzzleFirst = order[0] === "facial_mask" || order[0] === "muzzle";
    assert.ok(muzzleFirst, "unique-texture regions lead the fused vector");
    // A change in the leading (high-weight) biometric slice must hurt more
    // than the same change in the trailing (low-weight) coat slice.
    const hi = weightedMicroSimilarity(base, muzzleShift);
    const lo = weightedMicroSimilarity(base, coatShift);
    assert.ok(hi < lo, `high-weight slice change ${hi}% must score below low-weight ${lo}%`);
  });

  it("high-precision confidence separates identical twins / lookalikes", () => {
    const identical = fineGrainedConfidence({ globalScore: 100, microScore: 100, speciesMatch: true });
    assert.ok(identical >= 99, `identical pair must score ~100, got ${identical}`);
    const twin = fineGrainedConfidence({ globalScore: 92, microScore: 78, speciesMatch: true });
    assert.ok(twin < 85, `lookalike (global 92 / micro 78) must drop below 85, got ${twin}`);
    assert.ok(twin < 92, "confidence must sit below the misleading global score");
    assert.equal(fineGrainedConfidence({ globalScore: 99, microScore: 99, speciesMatch: false }), 0);
  });

  it("cascadeMatch reports both verification stages", () => {
    const out = cascadeMatch({ globalScore: 96, microScore: 93, sameSpecies: true });
    assert.equal(out.stage1Pass, true);
    assert.equal(out.speciesMatch, true);
    assert.ok(out.confidence > 85);
    assert.ok(out.verified, "strong global + micro verifies");
    const twin = cascadeMatch({ globalScore: 92, microScore: 70, sameSpecies: true });
    assert.equal(twin.stage1Pass, true);
    assert.equal(twin.verified, false, "twin fails fine-grained stage 2");
    const wrongSpecies = cascadeMatch({ globalScore: 99, microScore: 99, sameSpecies: false });
    assert.equal(wrongSpecies.stage1Pass, false);
    assert.equal(wrongSpecies.verified, false);
  });
});

describe("animal feature schema", () => {
  it("stores both global_embedding and micro_biometric_embedding vectors", () => {
    const Animal = require("../src/models/Animal.js");
    const attrs = Animal.getAttributes();
    const columns = Object.values(attrs).map((a) => a.field || null);
    assert.ok(attrs.globalEmbedding, "globalEmbedding attribute");
    assert.ok(attrs.microBiometricEmbedding, "microBiometricEmbedding attribute");
    assert.ok(columns.includes("global_embedding"), "global_embedding column");
    assert.ok(columns.includes("micro_biometric_embedding"), "micro_biometric_embedding column");
  });
});

describe("scan payload confidence metrics", () => {
  it("breaks confidence into species category vs biometric unique match", async () => {
    const queryPng = syntheticPNG(7);
    const query = await extractAnimalFeatures(queryPng, "image/png");
    const other = await extractAnimalFeatures(syntheticPNG(99), "image/png");

    const mk = (id, species, embedding, micro, ver) => ({
      id,
      tagNumber: `TAG-001-000${id}`,
      name: `Pet${id}`,
      species,
      breed: "Mix",
      status: "safe",
      embedding,
      globalEmbedding: embedding,
      microBiometricEmbedding: micro,
      embeddingVer: ver,
      angleEmbeddings: null,
      toJSON() {
        return { id, tagNumber: this.tagNumber, name: this.name, species, breed: "Mix", status: "safe", embedding, globalEmbedding: embedding, microBiometricEmbedding: micro, embeddingVer: ver, angleEmbeddings: null };
      },
    });
    const { EMBEDDING_VERSION } = require("../src/services/imageFeatures");
    const animals = [
      mk(1, "Dog", query.globalEmbedding, query.microEmbedding, EMBEDDING_VERSION),
      mk(2, "Dog", other.globalEmbedding, other.microEmbedding, EMBEDDING_VERSION),
      mk(3, "Cat", query.globalEmbedding, query.microEmbedding, EMBEDDING_VERSION),
    ];

    const animalPath = require.resolve("../src/models/Animal.js");
    require.cache[animalPath] = {
      id: animalPath,
      filename: animalPath,
      loaded: true,
      exports: { findAll: async () => animals },
    };
    const { scanPhoto } = require("../src/controllers/animalController.js");

    const workdir = fs.mkdtempSync(path.join(__dirname, ".tmp-fine-"));
    const tmp = path.join(workdir, "q.png");
    fs.writeFileSync(tmp, queryPng);
    const origLog = console.log;
    console.log = () => {};
    let payload = null;
    try {
      await scanPhoto(
        { file: { path: tmp, mimetype: "image/png" }, body: {} },
        { status: () => ({ json: () => {} }), json: (p) => { payload = p; } },
        (e) => { if (e) throw e; },
      );
    } finally {
      console.log = origLog;
      fs.rmSync(workdir, { recursive: true, force: true });
    }

    assert.ok(payload.matches.length >= 1);
    assert.ok(payload.matches.every((m) => m.animal.species === "Dog"), "strict same-species scope");
    const top = payload.matches[0];
    assert.equal(top.animal.id, 1);
    assert.equal(top.stage1Pass, true);
    assert.ok(top.confidence >= 95, `identical scan confidence ${top.confidence}`);
    const bd = top.confidenceBreakdown;
    assert.ok(bd, "confidence breakdown present");
    assert.equal(bd.speciesCategoryMatch, 100);
    assert.ok(bd.biometricUniqueMatch >= 95, `biometric unique ${bd.biometricUniqueMatch}`);
    assert.equal(bd.final, top.confidence);
    assert.ok(payload.match, "confident match set");
    assert.equal(payload.match.confidenceBreakdown.speciesCategoryMatch, 100);
    assert.ok(!("microBiometricEmbedding" in top.animal), "embeddings stay server-side");
    assert.ok(!("globalEmbedding" in top.animal), "embeddings stay server-side");
  });
});
