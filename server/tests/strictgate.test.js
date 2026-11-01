const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const {
  cosineSimilarity,
  toPercentage,
  passesStage1,
  passesStage2,
  weightedMicroSimilarity,
  fineGrainedConfidence,
  cascadeMatch,
  STAGE1_MIN_VISUAL,
  STAGE2_MIN_MICRO,
  STAGE2_MIN_CONFIDENCE,
} = require("../src/utils/similarity");
const { extractAnimalFeatures } = require("../src/services/samService");
const { EMBEDDING_VERSION } = require("../src/services/imageFeatures");

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

/** Load a fresh scanPhoto bound to the given mocked DB records. */
function loadControllerWithAnimals(animals) {
  const animalPath = require.resolve("../src/models/Animal.js");
  const controllerPath = require.resolve("../src/controllers/animalController.js");
  delete require.cache[controllerPath];
  require.cache[animalPath] = {
    id: animalPath,
    filename: animalPath,
    loaded: true,
    exports: { findAll: async () => animals },
  };
  return require(controllerPath).scanPhoto;
}

async function runScan(queryPng, animals, body = {}) {
  const scanPhoto = loadControllerWithAnimals(animals);
  const workdir = fs.mkdtempSync(path.join(__dirname, ".tmp-strict-"));
  const tmp = path.join(workdir, "q.png");
  fs.writeFileSync(tmp, queryPng);
  const origLog = console.log;
  console.log = () => {};
  let payload = null;
  try {
    await scanPhoto(
      { file: { path: tmp, mimetype: "image/png" }, body },
      { status: () => ({ json: () => {} }), json: (p) => { payload = p; } },
      (e) => { if (e) throw e; },
    );
  } finally {
    console.log = origLog;
    fs.rmSync(workdir, { recursive: true, force: true });
  }
  return payload;
}

const mk = (id, species, embedding, micro) => ({
  id,
  tagNumber: `TAG-001-000${id}`,
  name: `Pet${id}`,
  species,
  breed: "Mix",
  status: "safe",
  embedding,
  globalEmbedding: embedding,
  microBiometricEmbedding: micro,
  embeddingVer: EMBEDDING_VERSION,
  angleEmbeddings: null,
  toJSON() {
    return {
      id, tagNumber: this.tagNumber, name: this.name, species, breed: "Mix", status: "safe",
      embedding, globalEmbedding: embedding, microBiometricEmbedding: micro,
      embeddingVer: EMBEDDING_VERSION, angleEmbeddings: null,
    };
  },
});

describe("strict biometric match gate", () => {
  it("stage 2 requires a real micro comparison at/above the cutoff", () => {
    assert.equal(STAGE2_MIN_MICRO, 80);
    assert.equal(passesStage2({ microScore: 85 }), true);
    assert.equal(passesStage2({ microScore: 80 }), true);
    assert.equal(passesStage2({ microScore: 79.99 }), false);
    assert.equal(passesStage2({ microScore: null }), false);
    assert.equal(passesStage2({}), false);
  });

  it("a candidate MUST pass both stage 1 and stage 2 to verify", () => {
    assert.equal(STAGE1_MIN_VISUAL, 85);
    assert.equal(STAGE2_MIN_CONFIDENCE, 82);
    const full = cascadeMatch({ globalScore: 100, microScore: 100, sameSpecies: true });
    assert.equal(full.verified, true);

    // Missing micro data can never verify, even for a perfect global score.
    const noMicro = cascadeMatch({ globalScore: 100, microScore: null, sameSpecies: true });
    assert.equal(noMicro.stage1Pass, true);
    assert.equal(noMicro.stage2Pass, false);
    assert.equal(noMicro.verified, false);

    // Weak micro detail fails stage 2 despite a strong global score.
    const weakMicro = cascadeMatch({ globalScore: 96, microScore: 75, sameSpecies: true });
    assert.equal(weakMicro.stage1Pass, true);
    assert.equal(weakMicro.stage2Pass, false);
    assert.equal(weakMicro.verified, false);

    // Strong micro detail verifies.
    const strong = cascadeMatch({ globalScore: 96, microScore: 92, sameSpecies: true });
    assert.equal(strong.stage2Pass, true);
    assert.equal(strong.verified, true);

    // Stage 1 still gates: weak global never verifies even with strong micro.
    const weakGlobal = cascadeMatch({ globalScore: 70, microScore: 95, sameSpecies: true });
    assert.equal(passesStage1({ visual: 70, sameSpecies: true }), false);
    assert.equal(weakGlobal.verified, false);
  });
});

describe("stranger penalty", () => {
  // Seeds 7 and 10 share coat[1] and the same background: same fur color,
  // same setting — different animal (body proportions + spot pattern).
  it("drops confidence for same-coat strangers via micro-texture discrepancy", async () => {
    const a = await extractAnimalFeatures(syntheticPNG(7), "image/png");
    const stranger = await extractAnimalFeatures(syntheticPNG(10), "image/png");
    const global = toPercentage(cosineSimilarity(a.globalEmbedding, stranger.globalEmbedding));
    const micro = weightedMicroSimilarity(a.microEmbedding, stranger.microEmbedding);
    assert.ok(micro < global, `micro ${micro}% must sit below global ${global}% for strangers`);
    assert.ok(micro < STAGE2_MIN_MICRO, `stranger micro ${micro}% must fail the stage-2 cutoff`);
    const confidence = fineGrainedConfidence({ globalScore: global, microScore: micro, speciesMatch: true });
    assert.ok(confidence < STAGE2_MIN_CONFIDENCE, `stranger confidence ${confidence} must stay unverified`);
    assert.equal(cascadeMatch({ globalScore: global, microScore: micro, sameSpecies: true }).verified, false);
  });

  it("still verifies the same subject photographed on a new background", async () => {
    const a = await extractAnimalFeatures(syntheticPNG(7, [70, 130, 60]), "image/png");
    const same = await extractAnimalFeatures(syntheticPNG(7, [150, 150, 160]), "image/png");
    const global = toPercentage(cosineSimilarity(a.globalEmbedding, same.globalEmbedding));
    const micro = weightedMicroSimilarity(a.microEmbedding, same.microEmbedding);
    assert.ok(micro >= STAGE2_MIN_MICRO, `same-subject micro ${micro}% must clear stage 2`);
    const out = cascadeMatch({ globalScore: global, microScore: micro, sameSpecies: true });
    assert.equal(out.verified, true);
  });

  it("returns match:null with unverified suggestions for an unregistered pet", async () => {
    const registered = await extractAnimalFeatures(syntheticPNG(7), "image/png");
    const animals = [mk(1, "Dog", registered.globalEmbedding, registered.microEmbedding)];
    // Unseen animal, same fur color + background as the registered pet.
    const payload = await runScan(syntheticPNG(10), animals);

    assert.equal(payload.match, null);
    assert.ok(payload.matches.length >= 1, "ranked suggestions still returned");
    for (const suggestion of payload.matches) {
      assert.equal(suggestion.verified, false, "stranger suggestion marked unverified");
      assert.ok(suggestion.confidenceBreakdown, "breakdown present on suggestions");
    }
    // Stage 1 correctly recalls the lookalike — stage 2 rejects it.
    assert.equal(payload.matches[0].stage1Pass, true);
    assert.equal(payload.matches[0].stage2Pass, false);
  });

  it("still returns a verified match for a registered pet photo", async () => {
    const registered = await extractAnimalFeatures(syntheticPNG(7), "image/png");
    const animals = [mk(1, "Dog", registered.globalEmbedding, registered.microEmbedding)];
    const payload = await runScan(syntheticPNG(7), animals);

    assert.ok(payload.match, "identical photo must match");
    assert.equal(payload.match.animal.id, 1);
    assert.equal(payload.match.verified, true);
    assert.equal(payload.matches[0].verified, true);
  });
});
