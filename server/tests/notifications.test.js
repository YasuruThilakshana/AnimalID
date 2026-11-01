const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const { extractAnimalFeatures } = require("../src/services/samService");
const { EMBEDDING_VERSION } = require("../src/services/imageFeatures");

describe("owner notification schema", () => {
  it("stores owner-routed found-scan notifications", () => {
    // Real model — must load before the tests below stub it.
    const Notification = require("../src/models/Notification.js");
    assert.equal(Notification.getTableName(), "notifications");
    const attrs = Notification.getAttributes();
    for (const key of ["ownerEmail", "petId", "petName", "type", "title", "message", "location", "read"]) {
      assert.ok(attrs[key], `${key} attribute`);
    }
    assert.equal(attrs.ownerEmail.field, "owner_email");
  });
});

// ---- Mocked-model tests (run after the schema test above) ----
const notifPath = require.resolve("../src/models/Notification.js");
const animalPath = require.resolve("../src/models/Animal.js");

function makeNotifStore(initial = []) {
  const rows = initial.map((row, i) => ({ id: i + 1, read: false, ...row }));
  return {
    rows,
    model: {
      async create(data) {
        const row = { id: rows.length + 1, read: false, ...data };
        rows.push(row);
        return row;
      },
      async findOne({ where } = {}) {
        return rows.find((r) => Object.entries(where || {}).every(([k, v]) => r[k] === v)) || null;
      },
      async findAll({ where } = {}) {
        const out = rows.filter((r) => !where || Object.entries(where).every(([k, v]) => r[k] === v));
        return [...out].reverse();
      },
      async update(values, { where } = {}) {
        let count = 0;
        for (const row of rows) {
          if (Object.entries(where || {}).every(([k, v]) => row[k] === v)) {
            Object.assign(row, values);
            count += 1;
          }
        }
        return [count];
      },
    },
  };
}

function stubNotification(store) {
  require.cache[notifPath] = { id: notifPath, filename: notifPath, loaded: true, exports: store.model };
  for (const rel of ["../src/controllers/animalController.js", "../src/controllers/notificationsController.js"]) {
    delete require.cache[require.resolve(rel)];
  }
  return {
    animalController: require("../src/controllers/animalController.js"),
    notificationsController: require("../src/controllers/notificationsController.js"),
  };
}

function mockRes() {
  const res = { statusCode: 200, payload: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.payload = payload;
    return res;
  };
  return res;
}

const lostMatch = (overrides = {}) => ({
  verified: true,
  confidence: 100,
  animal: { id: 1, name: "Maple", status: "lost", ownerEmail: "owner@example.com", ...overrides.animal },
  ...overrides,
});

describe("found-scan owner trigger", () => {
  it("notifies on a 100% verified match for a missing pet, with sighting details", async () => {
    const store = makeNotifStore();
    const { animalController } = stubNotification(store);
    const out = await animalController.maybeNotifyFoundScan({
      match: lostMatch(),
      scanLocation: "Zilker Park",
    });
    assert.equal(out.notified, true);
    assert.equal(store.rows.length, 1);
    const [note] = store.rows;
    assert.equal(note.ownerEmail, "owner@example.com");
    assert.equal(note.petId, 1);
    assert.equal(note.type, "found_scan");
    assert.equal(note.read, false);
    assert.equal(
      note.message,
      "Your missing pet Maple has been found and scanned by a finder! Sighting details: scanned near Zilker Park.",
    );
  });

  it("still notifies without a sighting location, saying so", async () => {
    const store = makeNotifStore();
    const { animalController } = stubNotification(store);
    const out = await animalController.maybeNotifyFoundScan({ match: lostMatch(), scanLocation: null });
    assert.equal(out.notified, true);
    assert.equal(
      store.rows[0].message,
      "Your missing pet Maple has been found and scanned by a finder! No sighting location was shared — check Maple's profile for finder sightings.",
    );
  });

  it("stays silent below 100%, when unverified, or when not missing", async () => {
    const store = makeNotifStore();
    const { animalController } = stubNotification(store);
    const cases = [
      lostMatch({ confidence: 99.5 }),
      lostMatch({ verified: false }),
      lostMatch({ animal: { status: "safe" } }),
      lostMatch({ animal: { status: "found" } }),
      lostMatch({ animal: { ownerEmail: "" } }),
      null,
    ];
    for (const match of cases) {
      const out = await animalController.maybeNotifyFoundScan({ match, scanLocation: "Zilker Park" });
      assert.equal(out.notified, false);
    }
    assert.equal(store.rows.length, 0);
  });

  it("does not spam: one unread notification per missing pet", async () => {
    const store = makeNotifStore([
      { ownerEmail: "owner@example.com", petId: 1, type: "found_scan", read: false },
    ]);
    const { animalController } = stubNotification(store);
    const out = await animalController.maybeNotifyFoundScan({ match: lostMatch(), scanLocation: "Zilker Park" });
    assert.equal(out.notified, false);
    assert.equal(store.rows.length, 1);
  });

  it("re-notifies after the owner read the previous one", async () => {
    const store = makeNotifStore([
      { ownerEmail: "owner@example.com", petId: 1, type: "found_scan", read: true },
    ]);
    const { animalController } = stubNotification(store);
    const out = await animalController.maybeNotifyFoundScan({ match: lostMatch(), scanLocation: "Zilker Park" });
    assert.equal(out.notified, true);
    assert.equal(store.rows.length, 2);
  });
});

/** Same synthetic-animal generator style as the other scan tests (seed = identity). */
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

describe("scan wiring for owner notification", () => {
  async function runScan(queryPng, animals, body) {
    require.cache[animalPath] = {
      id: animalPath,
      filename: animalPath,
      loaded: true,
      exports: { findAll: async () => animals },
    };
    delete require.cache[require.resolve("../src/controllers/animalController.js")];
    const { scanPhoto } = require("../src/controllers/animalController.js");
    const workdir = fs.mkdtempSync(path.join(__dirname, ".tmp-notify-"));
    const tmp = path.join(workdir, "q.png");
    fs.writeFileSync(tmp, queryPng);
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    let payload = null;
    try {
      await scanPhoto(
        { file: { path: tmp, mimetype: "image/png" }, body },
        { status: () => ({ json: () => {} }), json: (p) => { payload = p; } },
        (e) => { if (e) throw e; },
      );
    } finally {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
      fs.rmSync(workdir, { recursive: true, force: true });
    }
    return payload;
  }

  const mk = (features, status) => ({
    id: 1,
    tagNumber: "TAG-001-0001",
    name: "Maple",
    species: "Dog",
    breed: "Mix",
    status,
    location: "Portland, OR",
    lostLocation: "Zilker Park",
    ownerEmail: "owner@example.com",
    embedding: features.globalEmbedding,
    globalEmbedding: features.globalEmbedding,
    microBiometricEmbedding: features.microEmbedding,
    embeddingVer: EMBEDDING_VERSION,
    angleEmbeddings: null,
    toJSON() {
      return { ...this };
    },
  });

  it("flags ownerNotified and stores the alert on a 100% lost-pet match", async () => {
    const store = makeNotifStore();
    stubNotification(store);
    const features = await extractAnimalFeatures(syntheticPNG(7), "image/png");
    const payload = await runScan(syntheticPNG(7), [mk(features, "lost")], { location: "Zilker Park" });
    assert.ok(payload.match, "identical scan matches");
    assert.equal(payload.match.verified, true);
    assert.equal(payload.ownerNotified, true);
    assert.equal(store.rows.length, 1);
    assert.match(store.rows[0].message, /Your missing pet Maple has been found and scanned by a finder!/);
    assert.match(store.rows[0].message, /Zilker Park/);

    const again = await runScan(syntheticPNG(7), [mk(features, "lost")], { location: "Zilker Park" });
    assert.equal(again.ownerNotified, false);
    assert.equal(store.rows.length, 1, "no duplicate while one is unread");
  });

  it("never notifies for safe pets or misses", async () => {
    const store = makeNotifStore();
    stubNotification(store);
    const features = await extractAnimalFeatures(syntheticPNG(7), "image/png");
    const payload = await runScan(syntheticPNG(7), [mk(features, "safe")], { location: "Zilker Park" });
    assert.equal(payload.ownerNotified, false);
    assert.equal(store.rows.length, 0);
  });
});

describe("notification api", () => {
  it("lists only the caller's notifications with an unread count", async () => {
    const store = makeNotifStore([
      { ownerEmail: "owner@example.com", message: "first", read: false },
      { ownerEmail: "owner@example.com", message: "second", read: true },
      { ownerEmail: "stranger@example.com", message: "theirs", read: false },
    ]);
    const { notificationsController } = stubNotification(store);
    const res = mockRes();
    await notificationsController.listMine({ user: { email: "OWNER@example.com" } }, res, (e) => { if (e) throw e; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.notifications.length, 2);
    assert.equal(res.payload.unreadCount, 1);
    assert.ok(res.payload.notifications.every((n) => n.ownerEmail === "owner@example.com"));
  });

  it("marks only the caller's notifications read", async () => {
    const store = makeNotifStore([
      { ownerEmail: "owner@example.com", message: "first", read: false },
      { ownerEmail: "stranger@example.com", message: "theirs", read: false },
    ]);
    const { notificationsController } = stubNotification(store);
    const res = mockRes();
    await notificationsController.readAll({ user: { email: "owner@example.com" } }, res, (e) => { if (e) throw e; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.marked, 1);
    assert.equal(store.rows[0].read, true);
    assert.equal(store.rows[1].read, false);
  });

  it("protects notification routes with auth", () => {
    const router = require("../src/routes/notificationsRoutes.js");
    const { requireAuth } = require("../src/controllers/authController");
    for (const [method, path] of [["get", "/"], ["post", "/read-all"]]) {
      const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
      assert.ok(layer, `${method.toUpperCase()} ${path} is registered`);
      assert.ok(
        layer.route.stack.some((s) => s.handle === requireAuth),
        `${method.toUpperCase()} ${path} requires auth`,
      );
    }
  });
});
