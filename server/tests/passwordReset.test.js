const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const reset = require("../src/utils/passwordReset");

// Real User model for the hashing contract (definitions only — no DB needed).
const RealUser = require("../src/models/User");

const OLD_ENV = {
  JWT_SECRET: process.env.JWT_SECRET,
  CLIENT_URL: process.env.CLIENT_URL,
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASS: process.env.EMAIL_PASS,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(OLD_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const fakeUser = (overrides = {}) => ({
  id: 7,
  name: "Test Owner",
  email: "owner@example.com",
  passwordHash: "old-hash",
  ...overrides,
});

describe("password reset validation helpers", () => {
  it("accepts valid emails and rejects malformed ones", () => {
    assert.equal(reset.isValidEmail("owner@example.com"), true);
    assert.equal(reset.isValidEmail("  Owner@Example.COM "), true);
    assert.equal(reset.isValidEmail("not-an-email"), false);
    assert.equal(reset.isValidEmail("missing@tld"), false);
    assert.equal(reset.isValidEmail(""), false);
    assert.equal(reset.isValidEmail(null), false);
  });

  it("enforces password complexity: 8+ chars with a letter and a number", () => {
    assert.equal(reset.passwordResetError("newPass123"), null);
    assert.match(reset.passwordResetError("short1"), /at least 8 characters/);
    assert.match(reset.passwordResetError("allletters"), /letter and one number/);
    assert.match(reset.passwordResetError("12345678"), /letter and one number/);
    assert.match(reset.passwordResetError(""), /at least 8 characters/);
  });

  it("builds reset links from CLIENT_URL with trailing slashes trimmed", () => {
    process.env.CLIENT_URL = "https://pets.example.com/";
    try {
      assert.equal(
        reset.buildResetLink("abc.def.ghi"),
        "https://pets.example.com/#/reset-password/abc.def.ghi",
      );
    } finally {
      restoreEnv();
    }
    delete process.env.CLIENT_URL;
    try {
      assert.equal(
        reset.buildResetLink("tok"),
        "http://localhost:5173/#/reset-password/tok",
      );
    } finally {
      restoreEnv();
    }
  });

  it("renders an HTML email with the link, expiry note, and escaped name", () => {
    const html = reset.resetEmailHtml("<b>Jo</b>", "https://app/#/reset-password/TOKEN");
    assert.match(html, /TOKEN/);
    assert.match(html, /15 minutes/);
    assert.match(html, /Reset my password/);
    assert.doesNotMatch(html, /<b>Jo<\/b>/);
    assert.match(html, /&lt;b&gt;Jo&lt;\/b&gt;/);
  });
});

describe("reset token lifecycle", () => {
  before(() => {
    process.env.JWT_SECRET = "test-jwt-secret";
  });
  after(restoreEnv);

  it("signs 15-minute tokens that verify for the same user", () => {
    const user = fakeUser();
    const token = reset.signResetToken(user);
    const payload = reset.verifyResetToken(token, user);
    assert.equal(payload.id, user.id);
    assert.equal(payload.email, user.email);
    assert.equal(payload.purpose, reset.RESET_TOKEN_PURPOSE);
    assert.equal(payload.exp - payload.iat, 15 * 60);
    assert.equal(reset.RESET_TOKEN_TTL, "15m");
  });

  it("rejects tampered, expired, and wrong-purpose tokens", () => {
    const user = fakeUser();
    const token = reset.signResetToken(user);
    assert.throws(() => reset.verifyResetToken(`${token}x`, user));
    assert.throws(() => reset.verifyResetToken("not-a-token", user));

    const secret = `${process.env.JWT_SECRET}::${user.passwordHash}`;
    const expired = jwt.sign(
      { id: user.id, email: user.email, purpose: reset.RESET_TOKEN_PURPOSE, exp: Math.floor(Date.now() / 1000) - 10 },
      secret,
    );
    assert.throws(() => reset.verifyResetToken(expired, user));

    const loginToken = jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: "7d" });
    assert.throws(() => reset.verifyResetToken(loginToken, user));
  });

  it("rejects a token verified against a different user", () => {
    const token = reset.signResetToken(fakeUser({ id: 7 }));
    assert.throws(() => reset.verifyResetToken(token, fakeUser({ id: 8 })));
  });

  it("invalidates outstanding tokens once the password hash rotates", () => {
    const before = fakeUser({ passwordHash: "hash-before" });
    const token = reset.signResetToken(before);
    assert.equal(reset.verifyResetToken(token, before).id, 7);
    const afterReset = fakeUser({ passwordHash: "hash-after" });
    assert.throws(() => reset.verifyResetToken(token, afterReset));
  });
});

describe("password hashing contract", () => {
  it("hashes with bcryptjs at salt factor 10", async () => {
    const hash = await RealUser.hashPassword("newPass123");
    assert.notEqual(hash, "newPass123");
    assert.equal(bcrypt.getRounds(hash), 10);
    assert.equal(await bcrypt.compare("newPass123", hash), true);
    assert.equal(await bcrypt.compare("wrongPass123", hash), false);
  });
});

describe("forgot-password / reset-password controllers", () => {
  const userPath = require.resolve("../src/models/User");
  const nodemailerPath = require.resolve("nodemailer");
  const controllerPath = require.resolve("../src/controllers/authController");
  const realUserCache = require.cache[userPath];
  const realNodemailerCache = require.cache[nodemailerPath];

  const sent = [];
  const saved = [];
  const created = [];
  let transportOpts = null;
  let sendFailure = null;
  let controller;
  const db = new Map();

  const req = (body = {}, params = {}) => ({ body, params });
  const res = () => {
    const out = { statusCode: 200, payload: null, cookies: {} };
    out.status = (code) => {
      out.statusCode = code;
      return out;
    };
    out.json = (payload) => {
      out.payload = payload;
      return out;
    };
    out.cookie = (name, value, opts) => {
      out.cookies[name] = { value, opts };
    };
    out.clearCookie = (name) => {
      delete out.cookies[name];
    };
    return out;
  };

  const captureConsoleError = () => {
    const errors = [];
    const origError = console.error;
    console.error = (...args) => void errors.push(args.join(" "));
    return { errors, release: () => { console.error = origError; } };
  };

  before(() => {
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.CLIENT_URL = "http://test.app";
    process.env.EMAIL_USER = "sender@example.com";
    process.env.EMAIL_PASS = "app-password";

    db.set("owner@example.com", {
      id: 7,
      name: "Test Owner",
      email: "owner@example.com",
      passwordHash: "hash-before",
      async save() {
        saved.push(this.passwordHash);
        return this;
      },
    });

    require.cache[userPath] = {
      exports: {
        hashPassword: RealUser.hashPassword,
        findOne: async ({ where }) => db.get(String(where.email).toLowerCase()) || null,
        create: async (fields) => {
          created.push(fields);
          return {
            id: 9,
            name: fields.name,
            email: fields.email,
            createdAt: new Date(),
            reload: async () => {},
          };
        },
        scope: () => ({
          findOne: async ({ where }) => db.get(String(where.email).toLowerCase()) || null,
          findByPk: async (id) => {
            for (const user of db.values()) {
              if (Number(user.id) === Number(id)) return user;
            }
            return null;
          },
        }),
      },
    };
    require.cache[nodemailerPath] = {
      exports: {
        createTransport: (opts) => {
          transportOpts = opts;
          return {
            sendMail: async (mail) => {
              if (sendFailure) throw sendFailure;
              sent.push(mail);
            },
          };
        },
      },
    };
    delete require.cache[controllerPath];
    controller = require("../src/controllers/authController");
  });

  after(() => {
    if (realUserCache) require.cache[userPath] = realUserCache;
    else delete require.cache[userPath];
    if (realNodemailerCache) require.cache[nodemailerPath] = realNodemailerCache;
    else delete require.cache[nodemailerPath];
    delete require.cache[controllerPath];
    restoreEnv();
  });

  it("rejects malformed emails with 400", async () => {
    const out = res();
    await controller.forgotPassword(req({ email: "bad" }), out, (err) => { throw err; });
    assert.equal(out.statusCode, 400);
  });

  it("returns 404 for unknown emails", async () => {
    const out = res();
    await controller.forgotPassword(req({ email: "nobody@example.com" }), out, (err) => { throw err; });
    assert.equal(out.statusCode, 404);
    assert.equal(sent.length, 0);
  });

  it("emails a 15-minute reset link built from CLIENT_URL", async () => {
    const out = res();
    await controller.forgotPassword(req({ email: "Owner@Example.com" }), out, (err) => { throw err; });
    assert.equal(out.statusCode, 200);
    assert.match(out.payload.message, /15 minutes/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "owner@example.com");
    assert.match(sent[0].subject, /Reset your AnimalID password/);
    assert.match(sent[0].html, /http:\/\/test\.app\/#\/reset-password\//);
    assert.deepEqual(transportOpts, {
      service: "gmail",
      auth: { user: "sender@example.com", pass: "app-password" },
    });
  });

  it("resets the password with bcryptjs(10) and retires the old token", async () => {
    const link = sent[0].html.match(/http:\/\/test\.app\/#\/reset-password\/([^"'\s&]+)/)[1];
    const token = decodeURIComponent(link);

    const weak = res();
    await controller.resetPassword(req({ password: "short" }, { token }), weak, (err) => { throw err; });
    assert.equal(weak.statusCode, 400);

    const out = res();
    await controller.resetPassword(req({ password: "brandNew99" }, { token }), out, (err) => { throw err; });
    assert.equal(out.statusCode, 200);
    assert.match(out.payload.message, /has been reset/);

    const user = db.get("owner@example.com");
    assert.equal(saved.length, 1);
    assert.equal(bcrypt.getRounds(user.passwordHash), 10);
    assert.equal(await bcrypt.compare("brandNew99", user.passwordHash), true);

    const reuse = res();
    await controller.resetPassword(req({ password: "another11" }, { token }), reuse, (err) => { throw err; });
    assert.equal(reuse.statusCode, 400);
    assert.match(reuse.payload.error, /invalid or has expired/);
  });

  it("rejects garbage tokens with 400", async () => {
    const out = res();
    await controller.resetPassword(req({ password: "brandNew99" }, { token: "garbage" }), out, (err) => { throw err; });
    assert.equal(out.statusCode, 400);
  });

  it("falls back to a dev reset link when email credentials are missing", async () => {
    const log = captureConsoleError();
    delete process.env.EMAIL_USER;
    try {
      const out = res();
      await controller.forgotPassword(req({ email: "owner@example.com" }), out, (err) => { throw err; });
      assert.equal(out.statusCode, 200);
      assert.match(out.payload.message, /development reset link/);
      assert.match(out.payload.devResetLink, /http:\/\/test\.app\/#\/reset-password\//);
      assert.match(log.errors.join("\n"), /failed: Email service is not configured/);
    } finally {
      process.env.EMAIL_USER = "sender@example.com";
      log.release();
    }
  });

  it("falls back to a dev reset link when SMTP sending fails", async () => {
    const log = captureConsoleError();
    sendFailure = Object.assign(new Error("Invalid login: 535-5.7.8"), { code: "EAUTH" });
    try {
      const out = res();
      await controller.forgotPassword(req({ email: "owner@example.com" }), out, (err) => { throw err; });
      assert.equal(out.statusCode, 200);
      assert.ok(out.payload.devResetLink);
      assert.match(log.errors.join("\n"), /Invalid login: 535-5\.7\.8 \(code: EAUTH\)/);
      // The fallback link carries a working token.
      const token = decodeURIComponent(out.payload.devResetLink.split("/reset-password/")[1]);
      const done = res();
      await controller.resetPassword(req({ password: "fallback99" }, { token }), done, (err) => { throw err; });
      assert.equal(done.statusCode, 200);
    } finally {
      sendFailure = null;
      log.release();
    }
  });

  it("returns a JSON 500 without a link in production when email fails", async () => {
    const log = captureConsoleError();
    const origNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.EMAIL_USER;
    try {
      const out = res();
      await controller.forgotPassword(req({ email: "owner@example.com" }), out, (err) => { throw err; });
      assert.equal(out.statusCode, 500);
      assert.equal(typeof out.payload.error, "string");
      assert.equal(out.payload.devResetLink, undefined);
    } finally {
      process.env.EMAIL_USER = "sender@example.com";
      if (origNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = origNodeEnv;
      log.release();
    }
  });

  it("hashes registration passwords with bcryptjs(10)", async () => {
    const out = res();
    await controller.register(
      req({ name: "New User", email: "newbie@example.com", password: "freshPass1" }),
      out,
      (err) => { throw err; },
    );
    assert.equal(out.statusCode, 201);
    assert.equal(created.length, 1);
    assert.equal(bcrypt.getRounds(created[0].passwordHash), 10);
    assert.equal(await bcrypt.compare("freshPass1", created[0].passwordHash), true);
  });
});

describe("auth router wiring", () => {
  it("exposes forgot/reset endpoints alongside the existing auth routes", () => {
    const router = require("../src/routes/authRoutes");
    const wired = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods).join(",")}:${layer.route.path}`);
    for (const expected of [
      "post:/register",
      "post:/login",
      "get:/me",
      "post:/forgot-password",
      "post:/reset-password/:token",
    ]) {
      assert.ok(wired.includes(expected), `missing route ${expected} (wired: ${wired.join(" ")})`);
    }
  });
});
