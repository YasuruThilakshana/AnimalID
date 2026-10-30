const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const {
  cosineSimilarity,
  toPercentage,
  rankByScore,
  normalizeVector,
} = require("../src/utils/similarity");
const { extractLocalFeatures, EMBEDDING_VERSION } = require("../src/services/imageFeatures");

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
        return { id, tagNumber: this.tagNumber, name: this.name, embedding, embeddingVer: ver, angleEmbeddings };
      },
    });
    const animals = [
      mk(1, queryVec, EMBEDDING_VERSION), // fused identical
      mk(2, otherVec, EMBEDDING_VERSION, { left: queryVec, right: otherVec }), // one angle identical
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
