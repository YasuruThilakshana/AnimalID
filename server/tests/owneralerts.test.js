process.env.JWT_SECRET = "owner-alerts-test-secret";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const SECRET = "owner-alerts-test-secret";
const ownerToken = jwt.sign({ id: 7, email: "owner@example.com" }, SECRET);
const strangerToken = jwt.sign({ id: 9, email: "stranger@example.com" }, SECRET);

describe("lostLocation schema", () => {
  it("stores the incident lost location next to the registered address", () => {
    // Real model — must load before the controller tests below stub it.
    const Animal = require("../src/models/Animal.js");
    const attrs = Animal.getAttributes();
    assert.ok(attrs.location, "registered address attribute");
    assert.ok(attrs.lostLocation, "lostLocation attribute");
    assert.equal(attrs.lostLocation.field, "lost_location");
  });
});

// ---- Mocked-record controller tests (runs after the schema test above) ----
const animalPath = require.resolve("../src/models/Animal.js");

function fakeAnimal(overrides = {}) {
  const record = {
    id: 1,
    name: "Maple",
    species: "Dog",
    status: "safe",
    location: "Portland, OR",
    lostLocation: "",
    ownerEmail: "owner@example.com",
    ownerName: "Olivia Owner",
    photos: {},
    imageUrl: null,
    timeline: [],
    sightings: [],
    updateCalls: [],
    destroyed: false,
    async update(data) {
      this.updateCalls.push(data);
      Object.assign(this, data);
      return this;
    },
    async save() {
      return this;
    },
    async reload() {
      return this;
    },
    async destroy() {
      this.destroyed = true;
    },
    toJSON() {
      return { ...this, updateCalls: undefined, destroyed: undefined };
    },
    ...overrides,
  };
  return record;
}

let store = {};
function stubAnimals(records) {
  store = {};
  for (const record of records) store[record.id] = record;
  require.cache[animalPath] = {
    id: animalPath,
    filename: animalPath,
    loaded: true,
    exports: { findByPk: async (id) => store[id] || null },
  };
  const controllerPath = require.resolve("../src/controllers/animalController.js");
  delete require.cache[controllerPath];
  return require(controllerPath);
}

function mockRes() {
  const res = { statusCode: 200, payload: null, ended: false };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.payload = payload;
    return res;
  };
  res.end = () => {
    res.ended = true;
    return res;
  };
  return res;
}

const { requireAuth } = require("../src/controllers/authController");

/**
 * Run requireAuth -> requireOwner -> handler like Express would, awaiting
 * each stage deterministically (Express never awaits next(), so a naive
 * nested-next harness races deep handler chains).
 */
async function runChain(controller, handlerName, { params, body, token, files }) {
  const req = {
    params: params || {},
    body: body || {},
    files,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    protocol: "http",
    get: () => "localhost",
  };
  const res = mockRes();
  const next = (err) => {
    if (err) throw err;
  };
  let authed = false;
  requireAuth(req, res, () => {
    authed = true;
  });
  if (!authed) return { req, res }; // 401 already sent
  let owned = false;
  await controller.requireOwner(req, res, () => {
    owned = true;
  });
  if (!owned) return { req, res }; // 403/404 already sent
  await controller[handlerName](req, res, next);
  return { req, res };
}

describe("owner-only alert authorization", () => {
  it("rejects unauthenticated and forged-token alert edits with 401", async () => {
    const controller = stubAnimals([fakeAnimal()]);
    const noToken = await runChain(controller, "updateAnimal", { params: { id: 1 }, body: { status: "lost" } });
    assert.equal(noToken.res.statusCode, 401);
    const forged = await runChain(controller, "updateAnimal", {
      params: { id: 1 },
      body: { status: "lost" },
      token: "forged.token.here",
    });
    assert.equal(forged.res.statusCode, 401);
  });

  it("rejects non-owner alert edits with 403 and changes nothing", async () => {
    const pet = fakeAnimal();
    const controller = stubAnimals([pet]);
    const { res } = await runChain(controller, "updateAnimal", {
      params: { id: 1 },
      body: { status: "lost", lostLocation: "Nowhere" },
      token: strangerToken,
    });
    assert.equal(res.statusCode, 403);
    assert.match(res.payload.error, /owner/i);
    assert.equal(pet.updateCalls.length, 0);
    assert.equal(pet.status, "safe");
  });

  it("returns 404 for missing pets even before the owner check", async () => {
    const controller = stubAnimals([]);
    const { res } = await runChain(controller, "updateAnimal", {
      params: { id: 999 },
      body: { status: "lost" },
      token: ownerToken,
    });
    assert.equal(res.statusCode, 404);
  });

  it("lets the verified owner trigger the missing alert", async () => {
    const pet = fakeAnimal();
    const controller = stubAnimals([pet]);
    const { res } = await runChain(controller, "updateAnimal", {
      params: { id: 1 },
      body: { status: "lost", lostLocation: "Zilker Park, north trail" },
      token: ownerToken,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(pet.status, "lost");
    assert.equal(pet.lostLocation, "Zilker Park, north trail");
    assert.equal(res.payload.lostLocation, "Zilker Park, north trail");
  });

  it("rejects non-owner alert deletion and lets the owner delete", async () => {
    const victim = fakeAnimal({ id: 2 });
    const controller = stubAnimals([victim]);
    const denied = await runChain(controller, "deleteAnimal", { params: { id: 2 }, token: strangerToken });
    assert.equal(denied.res.statusCode, 403);
    assert.equal(victim.destroyed, false);

    const own = fakeAnimal({ id: 3 });
    const controller2 = stubAnimals([own]);
    const allowed = await runChain(controller2, "deleteAnimal", { params: { id: 3 }, token: ownerToken });
    assert.equal(allowed.res.statusCode, 204);
    assert.equal(own.destroyed, true);
  });
});

describe("lost-location lifecycle", () => {
  it("keeps the incident location when reporting lost without one", async () => {
    const pet = fakeAnimal({ status: "lost", lostLocation: "Zilker Park" });
    const controller = stubAnimals([pet]);
    const { res } = await runChain(controller, "updateAnimal", {
      params: { id: 1 },
      body: { status: "lost", color: "Golden brown" },
      token: ownerToken,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(pet.lostLocation, "Zilker Park");
  });

  it("clears the incident location when the pet is marked safe", async () => {
    const pet = fakeAnimal({ status: "lost", lostLocation: "Zilker Park" });
    const controller = stubAnimals([pet]);
    const { res } = await runChain(controller, "updateAnimal", {
      params: { id: 1 },
      body: { status: "safe" },
      token: ownerToken,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(pet.status, "safe");
    assert.equal(pet.lostLocation, "");
  });

  it("leaves alert fields alone on unrelated profile edits", async () => {
    const pet = fakeAnimal({ status: "lost", lostLocation: "Zilker Park" });
    const controller = stubAnimals([pet]);
    const { res } = await runChain(controller, "updateAnimal", {
      params: { id: 1 },
      body: { color: "Golden brown" },
      token: ownerToken,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(pet.status, "lost");
    assert.equal(pet.lostLocation, "Zilker Park");
  });
});

describe("lost-only sighting reports", () => {
  const userPath = require.resolve("../src/models/User.js");

  function stubUser(name) {
    require.cache[userPath] = {
      id: userPath,
      filename: userPath,
      loaded: true,
      exports: { findByPk: async () => (name ? { id: 9, name, email: "stranger@example.com" } : null) },
    };
  }

  // Run requireAuth -> handler like Express would (sightings need a signed-in
  // reporter, but any user may report — never just the owner).
  async function runAuthed(controller, { params, body, token }) {
    const req = {
      params: params || {},
      body: body || {},
      headers: token ? { authorization: `Bearer ${token}` } : {},
    };
    const res = mockRes();
    let authed = false;
    requireAuth(req, res, () => {
      authed = true;
    });
    if (!authed) return { req, res };
    await controller.reportSighting(req, res, (err) => {
      if (err) throw err;
    });
    return { req, res };
  }

  it("rejects sightings for pets that are not marked lost", async () => {
    stubUser("Sam Reporter");
    const pet = fakeAnimal({ status: "safe" });
    const controller = stubAnimals([pet]);
    const { res } = await runAuthed(controller, {
      params: { id: 1 },
      body: { place: "Zilker Park", note: "Saw them!" },
      token: strangerToken,
    });
    assert.equal(res.statusCode, 403);
    assert.match(res.payload.error, /lost/i);
    assert.equal(pet.updateCalls.length, 0);
  });

  it("rejects unauthenticated sighting reports with 401", async () => {
    stubUser("Sam Reporter");
    const pet = fakeAnimal({ status: "lost" });
    const controller = stubAnimals([pet]);
    const { res } = await runAuthed(controller, {
      params: { id: 1 },
      body: { place: "Zilker Park" },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(pet.updateCalls.length, 0);
  });

  it("records the reporter's identity on the sighting", async () => {
    stubUser("Sam Reporter");
    const pet = fakeAnimal({ status: "lost" });
    const controller = stubAnimals([pet]);
    const { res } = await runAuthed(controller, {
      params: { id: 1 },
      body: { place: "Zilker Park", note: "Near the spring" },
      token: strangerToken,
    });
    assert.equal(res.statusCode, 201);
    const [sighting] = pet.sightings.slice(-1);
    assert.equal(sighting.place, "Zilker Park");
    assert.equal(sighting.reporterUserId, 9);
    assert.equal(sighting.reporterName, "Sam Reporter");
    assert.equal(sighting.reporterContact, "stranger@example.com");
    const last = res.payload.sightings[res.payload.sightings.length - 1];
    assert.equal(last.reporterName, "Sam Reporter");
  });
});

describe("alert route wiring", () => {
  it("protects alert edit/delete routes and requires sign-in (not ownership) for sightings", () => {
    const router = require("../src/routes/animalRoutes.js");
    const controller = require("../src/controllers/animalController.js");
    const handlesFor = (method, path) => {
      const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
      assert.ok(layer, `${method.toUpperCase()} ${path} is registered`);
      return layer.route.stack.map((s) => s.handle);
    };
    for (const [method, path] of [["put", "/:id"], ["delete", "/:id"]]) {
      const handles = handlesFor(method, path);
      assert.ok(handles.includes(requireAuth), `${method.toUpperCase()} ${path} requires auth`);
      assert.ok(handles.includes(controller.requireOwner), `${method.toUpperCase()} ${path} requires ownership`);
    }
    const sightingHandles = handlesFor("post", "/:id/sightings");
    assert.ok(sightingHandles.includes(requireAuth), "sighting reports require sign-in (reporter identity)");
    assert.ok(!sightingHandles.includes(controller.requireOwner), "any signed-in user may report");
  });
});
