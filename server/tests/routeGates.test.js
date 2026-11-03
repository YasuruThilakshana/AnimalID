const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Route-gate audit: every sensitive endpoint must carry its auth and
// throttling middleware in the Express stack — not just in comments.
// Pure router inspection (no sockets, no DB).
function handlers(router, method, path) {
  const layer = router.stack.find(
    (entry) => entry.route && entry.route.path === path && entry.route.methods[method],
  );
  assert.ok(layer, `${method.toUpperCase()} ${path} must be registered`);
  return layer.route.stack.map((entry) => entry.handle.name || "(anonymous)");
}

describe("auth route gates", () => {
  const routes = require("../src/routes/authRoutes");

  it("throttles credential and mail-sending endpoints", () => {
    for (const path of ["/register", "/login", "/forgot-password", "/reset-password/:token"]) {
      assert.ok(
        handlers(routes, "post", path).includes("rateLimitMiddleware"),
        `POST ${path} must be rate-limited`,
      );
    }
  });

  it("requires a session for /me", () => {
    assert.ok(handlers(routes, "get", "/me").includes("requireAuth"));
  });
});

describe("animal route gates", () => {
  const routes = require("../src/routes/animalRoutes");

  it("requires auth before anything else on registration", () => {
    const stack = handlers(routes, "post", "/");
    assert.equal(stack[0], "requireAuth");
    assert.ok(stack.includes("rateLimitMiddleware"));
  });

  it("locks the whole-DB reindex behind auth + a heavy limiter", () => {
    const stack = handlers(routes, "post", "/reindex");
    assert.ok(stack.includes("requireAuth"));
    assert.ok(stack.includes("rateLimitMiddleware"));
  });

  it("authenticates + throttles scans and sightings", () => {
    assert.ok(handlers(routes, "post", "/scan").includes("rateLimitMiddleware"));
    const sightings = handlers(routes, "post", "/:id/sightings");
    assert.ok(sightings.includes("requireAuth"));
    assert.ok(sightings.includes("rateLimitMiddleware"));
  });

  it("keeps owner-only edits ordered auth -> owner -> handler", () => {
    assert.deepEqual(handlers(routes, "put", "/:id").slice(0, 2), ["requireAuth", "requireOwner"]);
    assert.deepEqual(handlers(routes, "delete", "/:id").slice(0, 2), ["requireAuth", "requireOwner"]);
  });
});

describe("assistant route gates", () => {
  const routes = require("../src/routes/assistantRoutes");

  it("throttles the AI chat endpoint", () => {
    assert.ok(handlers(routes, "post", "/chat").includes("rateLimitMiddleware"));
  });
});

describe("messages route gates", () => {
  const routes = require("../src/routes/messagesRoutes");

  it("authenticates every thread/read/unread/peer lookup", () => {
    for (const [method, path] of [
      ["get", "/peer"],
      ["get", "/threads"],
      ["get", "/thread/:userId"],
      ["post", "/thread/:userId/read"],
      ["get", "/unread-count"],
    ]) {
      assert.ok(handlers(routes, method, path).includes("requireAuth"), `${method} ${path} must need auth`);
    }
  });

  it("authenticates + throttles sends and photo uploads", () => {
    for (const path of ["/", "/image"]) {
      const stack = handlers(routes, "post", path);
      assert.ok(stack.includes("requireAuth"), `POST ${path} must need auth`);
      assert.ok(stack.includes("rateLimitMiddleware"), `POST ${path} must be rate-limited`);
    }
    assert.ok(handlers(routes, "post", "/image").includes("chatPhotoUpload"));
  });
});

describe("alert + notification route gates", () => {
  it("throttles public alert subscriptions", () => {
    const routes = require("../src/routes/alertRoutes");
    assert.ok(handlers(routes, "post", "/subscribe").includes("rateLimitMiddleware"));
  });

  it("authenticates notification reads", () => {
    const routes = require("../src/routes/notificationsRoutes");
    assert.ok(handlers(routes, "get", "/").includes("requireAuth"));
    assert.ok(handlers(routes, "post", "/read-all").includes("requireAuth"));
  });
});
