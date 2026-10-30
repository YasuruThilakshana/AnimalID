const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

// Hermetic: the suite covers the deterministic local pipeline, never the
// live Meta API, even when a developer has SAM_API_KEY exported.
delete process.env.SAM_API_KEY;
delete process.env.SAM_API_URL;

const {
  cosineSimilarity,
  toPercentage,
  rankByScore,
  normalizeVector,
} = require("../src/utils/similarity");
const {
  extractLocalFeatures,
  extractFromCrop,
  prepareApiImage,
  EMBEDDING_VERSION,
} = require("../src/services/imageFeatures");
const {
  parseSamBoxes,
  extractOutputText,
  extractAnimalFeatures,
} = require("../src/services/samService");

/**
 * 96x96 PNG: noisy background + elliptical "animal" whose coat color, body
 * proportions, and spot pattern all derive from the seed — different seeds
 * are genuinely different-looking animals, like different DB records.
 */
function syntheticPNG(seed, bg = [70, 130, 60]) {
  const W = 96;
  const H = 96;
  const png = new PNG({ width: W, height: H });
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) / 16777216;
  };
  // Distinct coat per seed: brown dog-ish vs slate cat-ish vs sandy.
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

describe("cosine similarity", () => {
  it("scores identical vectors 100% and orthogonal 0%", () => {
    assert.equal(toPercentage(cosineSimilarity([1, 2, 3], [1, 2, 3])), 100);
    assert.equal(toPercentage(cosineSimilarity([1, 0], [0, 1])), 0);
    assert.equal(toPercentage(cosineSimilarity([1, 1], [-1, -1])), 0);
  });

  it("normalizes vectors to unit length", () => {
    const v = normalizeVector([3, 4]);
    assert.deepEqual(v, [0.6, 0.8]);
  });

  it("ranks scores strictly descending", () => {
    const out = rankByScore([
      { animal: { id: 2 }, score: 50 },
      { animal: { id: 1 }, score: 90 },
    ]);
    assert.deepEqual(
      out.map((e) => e.animal.id),
      [1, 2],
    );
  });
});

describe("segmentation + weighted feature extraction", () => {
  it("isolates the subject from the background", () => {
    const { segmentation } = extractLocalFeatures(syntheticPNG(7), "image/png");
    assert.equal(segmentation.applied, true);
    assert.ok(
      segmentation.fgFraction > 0.05 && segmentation.fgFraction < 0.9,
      `fgFraction ${segmentation.fgFraction}`,
    );
  });

  it("scores the exact same image 95-100% and unrelated photos lower", () => {
    const a = extractLocalFeatures(syntheticPNG(7), "image/png").embedding;
    const same = extractLocalFeatures(syntheticPNG(7), "image/png").embedding;
    const other = extractLocalFeatures(syntheticPNG(99), "image/png").embedding;
    assert.equal(a.length, 128);
    const samePct = toPercentage(cosineSimilarity(a, same));
    const otherPct = toPercentage(cosineSimilarity(a, other));
    assert.ok(samePct >= 95, `same image must score 95-100%, got ${samePct}%`);
    assert.ok(otherPct < samePct, `unrelated ${otherPct}% should rank below ${samePct}%`);
  });

  it("ignores background changes on the same subject", () => {
    const a = extractLocalFeatures(syntheticPNG(7, [70, 130, 60]), "image/png").embedding;
    const sameSubjectNewBg = extractLocalFeatures(syntheticPNG(7, [150, 150, 160]), "image/png").embedding;
    const other = extractLocalFeatures(syntheticPNG(99, [70, 130, 60]), "image/png").embedding;
    const bgRobust = toPercentage(cosineSimilarity(a, sameSubjectNewBg));
    const stranger = toPercentage(cosineSimilarity(a, other));
    assert.ok(bgRobust >= 75, `same subject with new background scored ${bgRobust}%`);
    assert.ok(bgRobust > stranger, `${bgRobust}% should beat unrelated ${stranger}%`);
  });
});

describe("SAM 3.1 Responses protocol", () => {
  it("parses box records and output text shapes", () => {
    const text = "<0f>1<|box;x1=444;y1=625;x2=679;y2=850;w=1800;h=1200|><|mask;x=0;y=0;data=1,2,!3|>";
    assert.deepEqual(parseSamBoxes(text), [
      { x1: 444, y1: 625, x2: 679, y2: 850, w: 1800, h: 1200 },
    ]);
    assert.deepEqual(parseSamBoxes(""), []);
    assert.deepEqual(parseSamBoxes(null), []);
    assert.equal(extractOutputText({ output_text: text }), text);
    assert.equal(
      extractOutputText({ output: [{ content: [{ text: "a" }, { text: "b" }] }] }),
      "ab",
    );
    assert.equal(
      extractOutputText({ choices: [{ message: { content: "hi" } }] }),
      "hi",
    );
  });

  it("extracts features from a SAM crop deterministically", () => {
    const png = syntheticPNG(7);
    const box = { x1: 20, y1: 18, x2: 76, y2: 78, w: 96, h: 96 };
    const a = extractFromCrop(png, "image/png", box);
    const b = extractFromCrop(Buffer.from(png), "image/png", box);
    assert.equal(a.segmentation.method, "sam-3.1-box");
    assert.equal(a.segmentation.applied, true);
    assert.equal(a.embedding.length, 128);
    assert.equal(toPercentage(cosineSimilarity(a.embedding, b.embedding)), 100);
  });

  it("prepares API uploads within payload limits", () => {
    const small = prepareApiImage(syntheticPNG(7), "image/png");
    assert.equal(small.width, 96);
    assert.ok(small.dataUrl.startsWith("data:image/png;base64,"));
  });
});

describe("scan endpoint", () => {
  it("always returns ranked top matches; same image scores 95%+ via best view", async () => {
    const queryPng = syntheticPNG(7);
    const queryVec = extractLocalFeatures(queryPng, "image/png").embedding;
    const otherVec = extractLocalFeatures(syntheticPNG(99), "image/png").embedding;

    const mk = (id, embedding, ver, angleEmbeddings = null) => ({
      id,
      tagNumber: `TAG-001-000${id}`,
      name: `Pet${id}`,
      species: "Dog",
      breed: "Mix",
      status: "safe",
      embedding,
      embeddingVer: ver,
      angleEmbeddings,
      toJSON() {
        return { id, tagNumber: this.tagNumber, name: this.name, species: "Dog", embedding, embeddingVer: ver, angleEmbeddings };
      },
    });
    const animals = [
      mk(1, queryVec, EMBEDDING_VERSION), // fused identical
      // Dual-shape entry (one angle identical) + legacy plain-array entry.
      mk(2, otherVec, EMBEDDING_VERSION, {
        left: { sam: otherVec, local: queryVec },
        right: otherVec,
      }),
      mk(3, queryVec, 1), // stale feature space: excluded
      mk(4, null, EMBEDDING_VERSION), // no embedding: excluded
    ];

    const animalPath = require.resolve("../src/models/Animal.js");
    require.cache[animalPath] = {
      id: animalPath,
      filename: animalPath,
      loaded: true,
      exports: { findAll: async () => animals },
    };
    const { scanPhoto } = require("../src/controllers/animalController.js");

    const workdir = fs.mkdtempSync(path.join(__dirname, ".tmp-scan-"));
    const tmp = path.join(workdir, "q.png");
    fs.writeFileSync(tmp, queryPng);
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args);
    };
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

    assert.equal(payload.threshold, 50);
    assert.equal(payload.totalCompared, 4);
    assert.equal(payload.scored, 2);
    assert.equal(payload.staleEmbeddings, 1);
    assert.equal(payload.withoutEmbeddings, 1);
    assert.equal(payload.segmentation.applied, true);
    // Top matches always returned, strictly ranked; best view wins per animal.
    assert.deepEqual(
      payload.matches.map((m) => m.animal.id),
      [1, 2],
    );
    assert.ok(payload.matches[0].score >= 95);
    assert.equal(payload.matches[1].view, "left");
    assert.ok(payload.matches[1].score >= 95);
    assert.ok(["primary", "local"].includes(payload.matches[1].pipeline));
    assert.equal(payload.match.animal.id, 1);
    for (const m of payload.matches) {
      assert.ok(!("embedding" in m.animal));
      assert.ok(!("angleEmbeddings" in m.animal));
    }
    assert.ok(
      logs.some(([msg]) => msg === "Calculated Similarity Scores:"),
      "scan must log calculated similarity scores",
    );
    const logged = logs.find(([msg]) => msg === "Calculated Similarity Scores:")[1];
    assert.deepEqual(
      logged.map((s) => s.id),
      [1, 2],
    );
    assert.ok(!fs.existsSync(tmp), "transient upload cleaned up");
  });
});

describe("registration/scan consistency", () => {
  it("extracts byte-identical vectors on repeat runs", async () => {
    const png = syntheticPNG(7);
    const a = await extractAnimalFeatures(png, "image/png");
    const b = await extractAnimalFeatures(Buffer.from(png), "image/png");
    assert.deepEqual(a.embedding, b.embedding);
    assert.deepEqual(a.localEmbedding, b.localEmbedding);
    // Hermetic fallback: the primary vector IS the deterministic local one.
    assert.deepEqual(a.embedding, a.localEmbedding);
  });

  it("scores 100% via local-vs-local when primaries disagree", () => {
    const controllerPath = require.resolve("../src/controllers/animalController.js");
    const { scoreCandidates } = require(controllerPath);
    // Simulates registration answering via SAM while the scan fell back (or
    // vice versa): the deterministic local pair still matches exactly.
    const best = scoreCandidates([1, 0], [0, 1], [
      { label: "fused", vector: [-1, 0] },
      { label: "front", vector: [0, 1] },
    ]);
    assert.equal(best.visual, 100);
    assert.equal(best.pipeline, "local");
    assert.equal(best.view, "front");
    assert.ok(best.vecHash);
  });

  it("scores 0 with no comparable vectors", () => {
    const controllerPath = require.resolve("../src/controllers/animalController.js");
    const { scoreCandidates } = require(controllerPath);
    assert.equal(scoreCandidates([1, 0], [], []).visual, 0);
  });
});

describe("reindex endpoint", () => {
  it("heals stale records from stored photos and skips current ones", async () => {
    const png = syntheticPNG(7);
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    const stale = {
      id: 9,
      photos: { front: dataUrl },
      imageUrl: null,
      embedding: [0.1, 0.2],
      embeddingVer: 1,
      angleEmbeddings: null,
      savedFields: null,
      async save({ fields }) {
        this.savedFields = fields;
      },
    };
    const current = {
      id: 10,
      photos: {},
      imageUrl: null,
      embedding: [0.5, 0.5],
      embeddingVer: EMBEDDING_VERSION,
      angleEmbeddings: { front: { sam: [0.5, 0.5], local: [0.5, 0.5] } },
      savedFields: null,
      async save({ fields }) {
        this.savedFields = fields;
      },
    };

    const controllerPath = require.resolve("../src/controllers/animalController.js");
    const animalPath = require.resolve("../src/models/Animal.js");
    delete require.cache[controllerPath];
    require.cache[animalPath] = {
      id: animalPath,
      filename: animalPath,
      loaded: true,
      exports: { findAll: async () => [stale, current] },
    };
    const { reindexEmbeddings } = require(controllerPath);

    const origLog = console.log;
    console.log = () => {};
    let payload = null;
    try {
      await reindexEmbeddings(
        {},
        { json: (p) => { payload = p; } },
        (e) => { if (e) throw e; },
      );
    } finally {
      console.log = origLog;
    }

    assert.deepEqual(payload, { total: 2, reindexed: 1, skipped: 1, failed: 0 });
    assert.equal(stale.embeddingVer, EMBEDDING_VERSION);
    assert.equal(stale.embedding.length, 128);
    assert.equal(stale.angleEmbeddings.front.local.length, 128);
    assert.deepEqual(stale.savedFields, ["embedding", "angleEmbeddings", "embeddingVer"]);
    assert.equal(current.savedFields, null);
  });
});

describe("permanent delete", () => {
  function stubController(findByPk) {
    const controllerPath = require.resolve("../src/controllers/animalController.js");
    const animalPath = require.resolve("../src/models/Animal.js");
    delete require.cache[controllerPath];
    require.cache[animalPath] = {
      id: animalPath,
      filename: animalPath,
      loaded: true,
      exports: { findByPk },
    };
    return require(controllerPath);
  }

  it("removes photo files and the DB row", async () => {
    const uploadsDir = path.join(__dirname, "..", "uploads");
    fs.mkdirSync(uploadsDir, { recursive: true });
    const stamp = Date.now();
    const files = [`del-test-${stamp}-front.jpg`, `del-test-${stamp}-left.jpg`];
    for (const f of files) fs.writeFileSync(path.join(uploadsDir, f), "fake-image");
    const record = {
      id: 11,
      tagNumber: "TAG-001-0011",
      photos: {
        front: `http://localhost:5000/uploads/${files[0]}`,
        left: `http://localhost:5000/uploads/${files[1]}`,
        right: "data:image/jpeg;base64,AAAA",
      },
      imageUrl: `http://localhost:5000/uploads/${files[0]}`,
      destroyed: false,
      async destroy() {
        this.destroyed = true;
      },
    };
    const { deleteAnimal } = stubController(async () => record);

    const origLog = console.log;
    console.log = () => {};
    let status = 0;
    let ended = false;
    try {
      await deleteAnimal(
        { params: { id: "11" } },
        { status: (c) => { status = c; return { end: () => { ended = true; }, json: () => {} }; } },
        (e) => { if (e) throw e; },
      );
    } finally {
      console.log = origLog;
      for (const f of files) fs.rmSync(path.join(uploadsDir, f), { force: true });
    }

    assert.equal(status, 204);
    assert.equal(ended, true);
    assert.equal(record.destroyed, true);
    for (const f of files) {
      assert.ok(!fs.existsSync(path.join(uploadsDir, f)), `${f} should be deleted`);
    }
  });

  it("returns 404 when the animal does not exist", async () => {
    const { deleteAnimal } = stubController(async () => null);
    let status = 0;
    let payload = null;
    await deleteAnimal(
      { params: { id: "999" } },
      { status: (c) => { status = c; return { json: (p) => { payload = p; }, end: () => {} }; } },
      (e) => { if (e) throw e; },
    );
    assert.equal(status, 404);
    assert.ok(payload.error);
  });
});

describe("strict species scoping", () => {
  function mkRecord({ id, species, embedding, angles = null }) {
    return {
      id,
      tagNumber: `TAG-001-${String(id).padStart(4, "0")}`,
      name: `Pet${id}`,
      species,
      breed: "Mix",
      status: "safe",
      embedding,
      embeddingVer: EMBEDDING_VERSION,
      angleEmbeddings: angles,
      toJSON() {
        return {
          id,
          tagNumber: this.tagNumber,
          name: this.name,
          species,
          embedding,
          embeddingVer: EMBEDDING_VERSION,
          angleEmbeddings: angles,
        };
      },
    };
  }

  async function runScan(records, body) {
    const controllerPath = require.resolve("../src/controllers/animalController.js");
    const animalPath = require.resolve("../src/models/Animal.js");
    delete require.cache[controllerPath];
    require.cache[animalPath] = {
      id: animalPath,
      filename: animalPath,
      loaded: true,
      exports: { findAll: async () => records },
    };
    const { scanPhoto } = require(controllerPath);
    const workdir = fs.mkdtempSync(path.join(__dirname, ".tmp-scan-"));
    const tmp = path.join(workdir, "q.png");
    fs.writeFileSync(tmp, syntheticPNG(7));
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

  it("excludes other species even at identical vectors when requested", async () => {
    const queryVec = extractLocalFeatures(syntheticPNG(7), "image/png").embedding;
    const otherVec = extractLocalFeatures(syntheticPNG(99), "image/png").embedding;
    const payload = await runScan(
      [
        mkRecord({ id: 1, species: "Dog", embedding: queryVec }),
        mkRecord({ id: 2, species: "Cat", embedding: queryVec }), // 100% but wrong species
        mkRecord({ id: 3, species: "Dog", embedding: otherVec }),
      ],
      { species: "Dog" },
    );
    assert.equal(payload.detectedSpecies, "Dog");
    assert.equal(payload.speciesRequested, "Dog");
    assert.deepEqual(
      payload.matches.map((m) => m.animal.id),
      [1, 3],
    );
    for (const m of payload.matches) assert.equal(m.animal.species, "Dog");
    assert.equal(payload.match.animal.id, 1);
  });

  it("auto-detects the species from the strongest visual score", async () => {
    const queryVec = extractLocalFeatures(syntheticPNG(7), "image/png").embedding;
    const otherVec = extractLocalFeatures(syntheticPNG(99), "image/png").embedding;
    const payload = await runScan(
      [
        mkRecord({ id: 1, species: "Dog", embedding: otherVec }),
        mkRecord({ id: 2, species: "Cat", embedding: queryVec }),
      ],
      {},
    );
    assert.equal(payload.detectedSpecies, "Cat");
    assert.equal(payload.speciesRequested, null);
    assert.deepEqual(
      payload.matches.map((m) => m.animal.id),
      [2],
    );
    assert.equal(payload.match.animal.species, "Cat");
  });

  it("location hints cannot drag auto-detection to the wrong species", async () => {
    const queryVec = extractLocalFeatures(syntheticPNG(7), "image/png").embedding;
    const otherVec = extractLocalFeatures(syntheticPNG(99), "image/png").embedding;
    const dog = mkRecord({ id: 1, species: "Dog", embedding: otherVec });
    dog.location = "Austin";
    const payload = await runScan(
      [dog, mkRecord({ id: 2, species: "Cat", embedding: queryVec })],
      { location: "Austin" },
    );
    assert.equal(payload.detectedSpecies, "Cat");
    assert.ok(payload.matches.every((m) => m.animal.species === "Cat"));
  });

  it("returns empty matches when the species has no records", async () => {
    const queryVec = extractLocalFeatures(syntheticPNG(7), "image/png").embedding;
    const payload = await runScan([mkRecord({ id: 1, species: "Dog", embedding: queryVec })], {
      species: "Elephant",
    });
    assert.equal(payload.detectedSpecies, "Elephant");
    assert.deepEqual(payload.matches, []);
    assert.equal(payload.match, null);
  });
});
