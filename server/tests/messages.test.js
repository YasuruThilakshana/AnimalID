const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { Op } = require("sequelize");

describe("message schema", () => {
  it("stores peer-to-peer messages", () => {
    // Real model — must load before the tests below stub it.
    const Message = require("../src/models/Message.js");
    assert.equal(Message.getTableName(), "messages");
    const attrs = Message.getAttributes();
    for (const key of ["senderId", "receiverId", "petId", "text", "imageUrl", "read"]) {
      assert.ok(attrs[key], `${key} attribute`);
    }
    assert.equal(attrs.senderId.field, "sender_id");
    assert.equal(attrs.receiverId.field, "receiver_id");
    assert.equal(attrs.imageUrl.field, "image_url");
  });
});

// ---- Mocked-model tests (run after the schema test above) ----
const messagePath = require.resolve("../src/models/Message.js");
const userPath = require.resolve("../src/models/User.js");
const animalPath = require.resolve("../src/models/Animal.js");

// Minimal where-matcher: equality, Op.or/Op.and groups, and IN arrays.
// (Reflect.ownKeys: Object.entries would skip the Op symbol keys.)
function matches(row, where) {
  if (!where) return true;
  return Reflect.ownKeys(where).every((key) => {
    const value = where[key];
    if (key === Op.or) return value.some((clause) => matches(row, clause));
    if (key === Op.and) return value.every((clause) => matches(row, clause));
    if (Array.isArray(value)) return value.includes(row[key]);
    return row[key] === value;
  });
}

function makeStore(initial = []) {
  const rows = initial.map((row, i) => ({ id: i + 1, ...row }));
  return {
    rows,
    model: {
      async create(data) {
        const row = { id: rows.length + 1, ...data };
        rows.push(row);
        return row;
      },
      async findByPk(id) {
        return rows.find((r) => r.id === id) || null;
      },
      async findOne({ where } = {}) {
        return rows.find((r) => matches(r, where)) || null;
      },
      async findAll({ where, order } = {}) {
        const out = rows.filter((r) => matches(r, where));
        if (order) {
          for (const [col, dir] of order) {
            out.sort((a, b) => (dir === "DESC" ? b[col] - a[col] : a[col] - b[col]));
          }
        }
        return out;
      },
      async update(values, { where } = {}) {
        let count = 0;
        for (const row of rows) {
          if (matches(row, where)) {
            Object.assign(row, values);
            count += 1;
          }
        }
        return [count];
      },
      async count({ where } = {}) {
        return rows.filter((r) => matches(r, where)).length;
      },
    },
  };
}

function stubModels({ messages = [], users = [], animals = [] } = {}) {
  const msgStore = makeStore(messages);
  const userStore = makeStore(users);
  const animalStore = makeStore(animals);
  require.cache[messagePath] = { id: messagePath, filename: messagePath, loaded: true, exports: msgStore.model };
  require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: userStore.model };
  require.cache[animalPath] = { id: animalPath, filename: animalPath, loaded: true, exports: animalStore.model };
  delete require.cache[require.resolve("../src/controllers/messagesController.js")];
  return {
    messages: msgStore,
    users: userStore,
    animals: animalStore,
    controller: require("../src/controllers/messagesController.js"),
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

const next = (err) => {
  if (err) throw err;
};

const req = (user, rest = {}) => ({ user, params: {}, body: {}, ...rest });
const ME = { id: 1, email: "me@example.com" };
const THEM = { id: 2, name: "Theo Finder", email: "theo@example.com" };

describe("message sending", () => {
  let ctx;
  beforeEach(() => {
    ctx = stubModels({ users: [{ name: "Me", email: ME.email }, THEM], animals: [{ name: "Maple" }] });
  });

  it("sends a message to another user", async () => {
    const res = mockRes();
    await ctx.controller.sendMessage(
      req(ME, { body: { receiverId: 2, text: "Hi, I found your dog!", petId: 1 } }),
      res,
      next,
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.message.senderId, 1);
    assert.equal(res.payload.message.receiverId, 2);
    assert.equal(res.payload.message.petId, 1);
    assert.equal(res.payload.message.read, false);
  });

  it("rejects empty, over-long, and self messages", async () => {
    for (const body of [
      { receiverId: 2, text: "   " },
      { receiverId: 2, text: "x".repeat(2001) },
      { receiverId: 1, text: "hello me" },
      { text: "no receiver" },
    ]) {
      const res = mockRes();
      await ctx.controller.sendMessage(req(ME, { body }), res, next);
      assert.equal(res.statusCode, 400);
    }
    assert.equal(ctx.messages.rows.length, 0);
  });

  it("sends messages with a chat photo attachment", async () => {
    const res = mockRes();
    await ctx.controller.sendMessage(
      req(ME, { body: { receiverId: 2, text: "Is this your dog?", imageUrl: "/uploads/123-456.jpg" } }),
      res,
      next,
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.message.imageUrl, "/uploads/123-456.jpg");
  });

  it("allows photo-only messages but rejects remote or unsafe image URLs", async () => {
    const photoOnly = mockRes();
    await ctx.controller.sendMessage(
      req(ME, { body: { receiverId: 2, text: "   ", imageUrl: "/uploads/123-456.png" } }),
      photoOnly,
      next,
    );
    assert.equal(photoOnly.statusCode, 201);
    for (const imageUrl of [
      "https://evil.example/x.jpg",
      "//evil.example/x.jpg",
      "/uploads/../../etc/passwd",
      "/uploads/x.svg",
      "/uploads/x.html",
      "javascript:alert(1)",
    ]) {
      const res = mockRes();
      await ctx.controller.sendMessage(req(ME, { body: { receiverId: 2, text: "hi", imageUrl } }), res, next);
      assert.equal(res.statusCode, 400, imageUrl);
    }
  });

  it("404s for unknown receivers and pets", async () => {
    const noUser = mockRes();
    await ctx.controller.sendMessage(req(ME, { body: { receiverId: 99, text: "hi" } }), noUser, next);
    assert.equal(noUser.statusCode, 404);
    const noPet = mockRes();
    await ctx.controller.sendMessage(req(ME, { body: { receiverId: 2, text: "hi", petId: 99 } }), noPet, next);
    assert.equal(noPet.statusCode, 404);
    assert.equal(ctx.messages.rows.length, 0);
  });
});

describe("message threads", () => {
  it("groups conversations per counterpart with unread counts", async () => {
    const ctx = stubModels({
      users: [{ name: "Me", email: ME.email }, THEM, { name: "Ann Owner", email: "ann@example.com" }],
      messages: [
        { senderId: 1, receiverId: 2, petId: null, text: "old", read: true, createdAt: 1 },
        { senderId: 2, receiverId: 1, petId: 1, text: "new from theo", read: false, createdAt: 3 },
        { senderId: 3, receiverId: 1, petId: null, text: "new from ann", read: false, createdAt: 2 },
        { senderId: 9, receiverId: 8, petId: null, text: "strangers", read: false, createdAt: 4 },
      ],
    });
    const res = mockRes();
    await ctx.controller.listThreads(req(ME), res, next);
    assert.equal(res.statusCode, 200);
    // Only my two threads, newest first; strangers' rows never leak.
    assert.deepEqual(
      res.payload.threads.map((t) => t.user.id),
      [2, 3],
    );
    assert.equal(res.payload.threads[0].lastMessage.text, "new from theo");
    assert.equal(res.payload.threads[0].unreadCount, 1);
    assert.equal(res.payload.threads[1].unreadCount, 1);
    assert.equal(res.payload.threads[0].user.name, "Theo Finder");
  });

  it("reads one thread chronologically and marks it read", async () => {
    const ctx = stubModels({
      users: [{ name: "Me", email: ME.email }, THEM],
      messages: [
        { senderId: 2, receiverId: 1, petId: null, text: "first", read: false, createdAt: 2 },
        { senderId: 1, receiverId: 2, petId: null, text: "second", read: false, createdAt: 3 },
        { senderId: 2, receiverId: 1, petId: null, text: "third", read: false, createdAt: 1 },
      ],
    });
    const res = mockRes();
    await ctx.controller.getThread(req(ME, { params: { userId: "2" } }), res, next);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.user.name, "Theo Finder");
    assert.deepEqual(
      res.payload.messages.map((m) => m.text),
      ["third", "first", "second"],
    );
    const marked = mockRes();
    await ctx.controller.markThreadRead(req(ME, { params: { userId: "2" } }), marked, next);
    assert.deepEqual(marked.payload, { ok: true, marked: 2 });
    const unread = mockRes();
    await ctx.controller.unreadCount(req(ME), unread, next);
    assert.deepEqual(unread.payload, { unreadCount: 0 });
  });

  it("404s threads with unknown users", async () => {
    const ctx = stubModels({ users: [{ name: "Me", email: ME.email }] });
    const res = mockRes();
    await ctx.controller.getThread(req(ME, { params: { userId: "99" } }), res, next);
    assert.equal(res.statusCode, 404);
  });
});

describe("chat photo upload", () => {
  it("returns a relative uploads URL for an image file", async () => {
    const ctx = stubModels({});
    const res = mockRes();
    await ctx.controller.uploadMessageImage(
      { file: { filename: "123-456.jpg", path: "/tmp/never-written-123.jpg" } },
      res,
      next,
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.imageUrl, "/uploads/123-456.jpg");
  });

  it("rejects missing files and non-photo extensions", async () => {
    const ctx = stubModels({});
    const missing = mockRes();
    await ctx.controller.uploadMessageImage({ file: undefined }, missing, next);
    assert.equal(missing.statusCode, 400);
    const badExt = mockRes();
    await ctx.controller.uploadMessageImage(
      { file: { filename: "123-456.svg", path: "/tmp/never-written-456.svg" } },
      badExt,
      next,
    );
    assert.equal(badExt.statusCode, 400);
    assert.match(badExt.payload.error, /JPG|PNG/i);
  });
});

describe("peer lookup", () => {
  it("resolves a chat peer by email", async () => {
    const ctx = stubModels({ users: [{ name: "Me", email: ME.email }, THEM] });
    const res = mockRes();
    await ctx.controller.getPeerByEmail(req(ME, { query: { email: "theo@example.com" } }), res, next);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.user, { id: 2, name: "Theo Finder", email: "theo@example.com" });
  });

  it("400s on missing email and 404s unknown peers", async () => {
    const ctx = stubModels({ users: [{ name: "Me", email: ME.email }] });
    const missing = mockRes();
    await ctx.controller.getPeerByEmail(req(ME, { query: {} }), missing, next);
    assert.equal(missing.statusCode, 400);
    const unknown = mockRes();
    await ctx.controller.getPeerByEmail(req(ME, { query: { email: "nobody@example.com" } }), unknown, next);
    assert.equal(unknown.statusCode, 404);
  });
});
