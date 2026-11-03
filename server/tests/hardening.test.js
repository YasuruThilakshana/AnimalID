const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const { cookieParser, parseCookies } = require("../src/middleware/cookies");
const { sanitizeInputs, sanitizeValue } = require("../src/middleware/sanitize");
const { rateLimit, limiters } = require("../src/middleware/rateLimit");
const { apiErrorHandler } = require("../src/middleware/errorHandler");

function mockRes() {
  const out = {
    statusCode: 200,
    payload: null,
    headers: {},
    headersSent: false,
    cookies: {},
    cleared: [],
  };
  out.status = (code) => {
    out.statusCode = code;
    return out;
  };
  out.json = (payload) => {
    out.payload = payload;
    return out;
  };
  out.setHeader = (name, value) => {
    out.headers[name] = value;
  };
  out.cookie = (name, value, opts) => {
    out.cookies[name] = { value, opts };
  };
  out.clearCookie = (name, opts) => {
    out.cleared.push(name);
    delete out.cookies[name];
    return opts;
  };
  return out;
}

describe("cookie parsing middleware", () => {
  it("parses a Cookie header into req.cookies", () => {
    assert.deepEqual(parseCookies("a=1; animalid_session=tok123; theme=dark"), {
      a: "1",
      animalid_session: "tok123",
      theme: "dark",
    });
  });

  it("tolerates missing, empty, and malformed headers", () => {
    assert.deepEqual(parseCookies(undefined), {});
    assert.deepEqual(parseCookies(""), {});
    assert.deepEqual(parseCookies(";;;noequals"), {});
    // Bad percent-encoding falls back to the raw value instead of throwing.
    assert.deepEqual(parseCookies("x=%E0%A4%A"), { x: "%E0%A4%A" });
    assert.equal(parseCookies("jwt=abc%20def").jwt, "abc def");
  });

  it("cookieParser populates req.cookies and always calls next", () => {
    const req = { headers: { cookie: "animalid_session=abc" } };
    let nextCalled = 0;
    cookieParser(req, {}, () => {
      nextCalled += 1;
    });
    assert.equal(req.cookies.animalid_session, "abc");
    assert.equal(nextCalled, 1);
    const bare = { headers: {} };
    cookieParser(bare, {}, () => {
      nextCalled += 1;
    });
    assert.deepEqual(bare.cookies, {});
    assert.equal(nextCalled, 2);
  });
});

describe("input sanitization middleware", () => {
  it("trims strings and strips NUL bytes, recursively", () => {
    const body = {
      name: "  Ash  ",
      nested: { place: "Park\0side ", tags: [" a ", 7, null] },
    };
    sanitizeValue(body, 0);
    assert.equal(body.name, "Ash");
    assert.equal(body.nested.place, "Parkside");
    assert.deepEqual(body.nested.tags, ["a", 7, null]);
  });

  it("leaves credential fields byte-identical", () => {
    const body = { password: "  spaced\0 ", name: " x " };
    sanitizeValue(body, 0);
    assert.equal(body.password, "  spaced\0 ");
    assert.equal(body.name, "x");
  });

  it("sanitizes body, query, and params, then calls next", () => {
    const req = {
      body: { note: " hi " },
      query: { q: " x\0" },
      params: { id: " 5 " },
    };
    let nextCalled = 0;
    sanitizeInputs(req, {}, () => {
      nextCalled += 1;
    });
    assert.equal(req.body.note, "hi");
    assert.equal(req.query.q, "x");
    assert.equal(req.params.id, "5");
    assert.equal(nextCalled, 1);
  });
});

describe("in-memory rate limiter", () => {
  const hit = (mw, ip) => {
    const req = { ip };
    const res = mockRes();
    let nextCalled = 0;
    mw(req, res, () => {
      nextCalled += 1;
    });
    return { req, res, nextCalled };
  };

  it("passes requests under the limit and emits limit headers", () => {
    const mw = rateLimit({ windowMs: 60000, max: 2 });
    const first = hit(mw, "1.2.3.4");
    assert.equal(first.nextCalled, 1);
    assert.equal(first.res.headers["X-RateLimit-Limit"], "2");
    assert.equal(first.res.headers["X-RateLimit-Remaining"], "1");
    const second = hit(mw, "1.2.3.4");
    assert.equal(second.nextCalled, 1);
    assert.equal(second.res.headers["X-RateLimit-Remaining"], "0");
  });

  it("rejects over-limit requests with 429 + Retry-After", () => {
    const mw = rateLimit({ windowMs: 60000, max: 1, message: "Slow down." });
    assert.equal(hit(mw, "9.9.9.9").nextCalled, 1);
    const blocked = hit(mw, "9.9.9.9");
    assert.equal(blocked.nextCalled, 0);
    assert.equal(blocked.res.statusCode, 429);
    assert.equal(blocked.res.payload.error, "Slow down.");
    assert.ok(Number(blocked.res.headers["Retry-After"]) >= 1);
  });

  it("tracks clients independently", () => {
    const mw = rateLimit({ windowMs: 60000, max: 1 });
    assert.equal(hit(mw, "10.0.0.1").nextCalled, 1);
    assert.equal(hit(mw, "10.0.0.2").nextCalled, 1);
    assert.equal(hit(mw, "10.0.0.1").res.statusCode, 429);
  });

  it("exposes a limiter preset for every sensitive surface", () => {
    for (const name of ["auth", "password", "chat", "message", "upload", "scan", "sighting", "heavy"]) {
      assert.equal(typeof limiters[name], "function", `${name} preset missing`);
      assert.equal(typeof limiters[name](), "function", `${name} preset must build middleware`);
    }
  });
});

describe("global API error boundary", () => {
  const captureError = () => {
    const orig = console.error;
    console.error = () => {};
    return () => {
      console.error = orig;
    };
  };

  it("delegates when headers are already sent (proxy reset path)", () => {
    const release = captureError();
    try {
      const res = mockRes();
      res.headersSent = true;
      let delegated = null;
      const err = new Error("socket hang up");
      apiErrorHandler(err, {}, res, (e) => {
        delegated = e;
      });
      assert.equal(delegated, err);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload, null);
    } finally {
      release();
    }
  });

  it("maps upload-filter and oversized-body errors to 4xx JSON", () => {
    const release = captureError();
    try {
      const imageRes = mockRes();
      apiErrorHandler(new Error("Only image uploads are allowed"), {}, imageRes, () => {});
      assert.equal(imageRes.statusCode, 400);
      assert.match(imageRes.payload.error, /Only image uploads/);
      const bigRes = mockRes();
      apiErrorHandler({ type: "entity.too.large" }, {}, bigRes, () => {});
      assert.equal(bigRes.statusCode, 413);
    } finally {
      release();
    }
  });

  it("hides internal details behind a generic 500", () => {
    const release = captureError();
    try {
      const res = mockRes();
      apiErrorHandler(new Error("jwt malformed + SECRET=leak"), {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.payload, { error: "Something went wrong. Please try again." });
    } finally {
      release();
    }
  });
});

describe("HTTP-only cookie sessions", () => {
  const OLD_SECRET = process.env.JWT_SECRET;
  const userPath = require.resolve("../src/models/User");
  const controllerPath = require.resolve("../src/controllers/authController");
  const realUserCache = require.cache[userPath];
  let controller;

  before(() => {
    process.env.JWT_SECRET = "hardening-test-secret";
    const stored = {
      id: 3,
      name: "Cookie Owner",
      email: "cookie@example.com",
      createdAt: new Date("2024-01-01"),
      reload: async () => {},
      checkPassword: async (pw) => pw === "correct-horse",
    };
    require.cache[userPath] = {
      exports: {
        hashPassword: async (pw) => `hashed:${pw}`,
        findOne: async () => null,
        create: async (fields) => ({ ...stored, ...fields }),
        scope: () => ({ findOne: async () => stored }),
      },
    };
    delete require.cache[controllerPath];
    controller = require("../src/controllers/authController");
  });

  after(() => {
    if (realUserCache) require.cache[userPath] = realUserCache;
    else delete require.cache[userPath];
    delete require.cache[controllerPath];
    if (OLD_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = OLD_SECRET;
  });

  it("register sets an HTTP-only SameSite session cookie", async () => {
    const res = mockRes();
    let nextErr = null;
    await controller.register(
      { body: { name: "Cookie Owner", email: "cookie@example.com", password: "correct-horse" } },
      res,
      (e) => {
        nextErr = e;
      },
    );
    assert.equal(nextErr, null);
    assert.equal(res.statusCode, 201);
    const jar = res.cookies[controller.SESSION_COOKIE];
    assert.ok(jar, "session cookie must be set");
    assert.equal(jar.opts.httpOnly, true);
    assert.equal(jar.opts.sameSite, "lax");
    assert.equal(jar.opts.path, "/");
    assert.ok(typeof jar.value === "string" && jar.value.length > 10);
  });

  it("requireAuth accepts the session cookie", () => {
    const token = jwt.sign({ id: 3, email: "cookie@example.com" }, "hardening-test-secret");
    const req = { headers: {}, cookies: { [controller.SESSION_COOKIE]: token } };
    const res = mockRes();
    let nextCalled = 0;
    controller.requireAuth(req, res, () => {
      nextCalled += 1;
    });
    assert.equal(nextCalled, 1);
    assert.equal(req.user.id, 3);
    assert.equal(req.user.email, "cookie@example.com");
  });

  it("requireAuth keeps the Bearer fallback and rejects anonymous calls", () => {
    const token = jwt.sign({ id: 3, email: "cookie@example.com" }, "hardening-test-secret");
    const viaBearer = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
    let nextCalled = 0;
    controller.requireAuth(viaBearer, mockRes(), () => {
      nextCalled += 1;
    });
    assert.equal(nextCalled, 1);
    assert.equal(viaBearer.user.id, 3);
    const anon = { headers: {}, cookies: {} };
    const anonRes = mockRes();
    controller.requireAuth(anon, anonRes, () => {
      nextCalled += 1;
    });
    assert.equal(anonRes.statusCode, 401);
    assert.equal(nextCalled, 1);
  });

  it("logout clears the session cookie", () => {
    const res = mockRes();
    controller.logout({}, res);
    assert.deepEqual(res.payload, { ok: true });
    assert.ok(res.cleared.includes(controller.SESSION_COOKIE));
  });
});

describe("strict pet/sighting validation", () => {
  const animalPath = require.resolve("../src/models/Animal");
  const controllerPath = require.resolve("../src/controllers/animalController");
  const realAnimalCache = require.cache[animalPath];
  let animals;

  before(() => {
    require.cache[animalPath] = {
      exports: {
        findByPk: async (id) => (Number(id) === 11
          ? { id: 11, status: "lost", sightings: [], timeline: [] }
          : null),
      },
    };
    delete require.cache[controllerPath];
    animals = require("../src/controllers/animalController");
  });

  after(() => {
    if (realAnimalCache) require.cache[animalPath] = realAnimalCache;
    else delete require.cache[animalPath];
    delete require.cache[controllerPath];
  });

  it("accepts a valid profile and rejects oversized fields, bad status, bad email", () => {
    assert.equal(
      animals.validateAnimalFields({ name: "Ash", species: "Dog", status: "lost", ownerEmail: "a@b.co" }),
      null,
    );
    assert.match(animals.validateAnimalFields({ name: "x".repeat(121) }), /under 120 characters/);
    assert.match(animals.validateAnimalFields({ name: "Ash", status: "missing" }), /safe, lost, or found/);
    assert.match(
      animals.validateAnimalFields({ name: "Ash", ownerEmail: "not-an-email" }),
      /valid owner email/,
    );
    assert.equal(animals.validateAnimalFields({ name: "Ash" }), null);
  });

  it("rejects overlong sighting place/note with 400 before any write", async () => {
    const long = async (place, note) => {
      const res = mockRes();
      let nextErr = null;
      await animals.reportSighting(
        { params: { id: 11 }, body: { place, note }, user: { id: 3 } },
        res,
        (e) => {
          nextErr = e;
        },
      );
      return { res, nextErr };
    };
    const byPlace = await long("p".repeat(201), "ok");
    assert.equal(byPlace.res.statusCode, 400);
    const byNote = await long("Park gate", "n".repeat(2001));
    assert.equal(byNote.res.statusCode, 400);
    assert.equal(byNote.nextErr, null);
  });
});
