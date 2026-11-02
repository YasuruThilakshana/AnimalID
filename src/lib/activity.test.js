import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterRecoveryFeed,
  filterUserActivity,
  inferActivityKind,
  isRecoveryActivity,
  isUserActivity,
} from "./activity.js";

describe("inferActivityKind", () => {
  it("maps known log texts to kinds", () => {
    assert.equal(inferActivityKind("Maple was reported lost"), "lost");
    assert.equal(inferActivityKind("Maple was reported found"), "found");
    assert.equal(inferActivityKind("Maple was marked safe"), "found");
    assert.equal(inferActivityKind("Sighting of Maple at Zilker Park"), "sighting");
    assert.equal(inferActivityKind("Maple's alert location was updated"), "lost");
    assert.equal(inferActivityKind("Photo scan run (top match TAG-001-0001 at 92.4%)"), "scan");
    assert.equal(inferActivityKind("Photo scan run (no high-confidence matches)"), "scan");
  });

  it("maps non-recovery texts to other", () => {
    for (const text of [
      "Ava created an account",
      "Ava signed in",
      "Maple was registered (TAG-001-0001)",
      "Maple's profile was updated",
      "Maple (TAG-001-0001) was removed",
      "",
      null,
      undefined,
    ]) {
      assert.equal(inferActivityKind(text), "other");
    }
  });
});

describe("isRecoveryActivity", () => {
  it("keeps only lost/found/sighting/recovery kinds", () => {
    for (const kind of ["lost", "found", "sighting", "recovery"]) {
      assert.equal(isRecoveryActivity({ t: 1, text: "x", email: "a@x.com", kind }), true);
    }
    for (const kind of ["scan", "account", "register", "update", "remove", "other"]) {
      assert.equal(isRecoveryActivity({ t: 1, text: "x", email: "a@x.com", kind }), false);
    }
  });

  it("filters legacy entries without kind by text", () => {
    assert.equal(isRecoveryActivity({ t: 1, text: "Maple was reported lost", email: null }), true);
    assert.equal(isRecoveryActivity({ t: 1, text: "Sighting of Maple at park", email: null }), true);
    assert.equal(isRecoveryActivity({ t: 1, text: "Maple was reported found", email: null }), true);
    assert.equal(isRecoveryActivity({ t: 1, text: "Photo scan run (no matches)", email: null }), false);
    assert.equal(isRecoveryActivity({ t: 1, text: "Maple was registered (TAG-1)", email: "a@x.com" }), false);
    assert.equal(isRecoveryActivity({ t: 1, text: "Ava signed in", email: "a@x.com" }), false);
  });

  it("never throws on missing entries", () => {
    assert.equal(isRecoveryActivity(null), false);
    assert.equal(isRecoveryActivity(undefined), false);
    assert.equal(isRecoveryActivity({}), false);
  });
});

describe("filterRecoveryFeed", () => {
  it("drops scans and non-reports, keeps order and limit", () => {
    const feed = [
      { t: 3, text: "Photo scan run (no matches)", email: null },
      { t: 2, text: "Maple was reported lost", email: "a@x.com" },
      { t: 1, text: "Ava signed in", email: "a@x.com" },
      { t: 0, text: "Sighting of Maple at park", email: "b@x.com" },
    ];
    const out = filterRecoveryFeed(feed, 3);
    assert.deepEqual(
      out.map((a) => a.text),
      ["Maple was reported lost", "Sighting of Maple at park"],
    );
    assert.equal(filterRecoveryFeed(feed, 1).length, 1);
    assert.deepEqual(filterRecoveryFeed(null), []);
    assert.deepEqual(filterRecoveryFeed("nope"), []);
  });
});

describe("isUserActivity", () => {
  it("matches only the exact current-user email", () => {
    assert.equal(isUserActivity({ email: "a@x.com" }, "a@x.com"), true);
    assert.equal(isUserActivity({ email: null }, "a@x.com"), false);
    assert.equal(isUserActivity({ email: undefined }, "a@x.com"), false);
    assert.equal(isUserActivity({ email: "b@x.com" }, "a@x.com"), false);
    assert.equal(isUserActivity({ email: "a@x.com" }, ""), false);
    assert.equal(isUserActivity(null, "a@x.com"), false);
  });
});

describe("sign-out event", () => {
  it("stays out of the recovery feed but linked to the user", () => {
    const entry = { t: 1, text: "Signed out", email: "a@x.com" };
    assert.equal(inferActivityKind(entry.text), "other");
    assert.equal(isRecoveryActivity(entry), false);
    assert.equal(isUserActivity(entry, "a@x.com"), true);
    assert.equal(isUserActivity(entry, "b@x.com"), false);
    assert.deepEqual(filterUserActivity([entry], "a@x.com", 6), [entry]);
  });
});

describe("filterUserActivity", () => {
  it("drops global and other-user entries, keeps order and limit", () => {
    const feed = [
      { t: 3, text: "global scan", email: null },
      { t: 2, text: "mine", email: "a@x.com" },
      { t: 1, text: "theirs", email: "b@x.com" },
      { t: 0, text: "mine again", email: "a@x.com" },
    ];
    const out = filterUserActivity(feed, "a@x.com", 6);
    assert.deepEqual(
      out.map((a) => a.text),
      ["mine", "mine again"],
    );
    assert.equal(filterUserActivity(feed, "a@x.com", 1).length, 1);
    assert.deepEqual(filterUserActivity(feed, ""), []);
    assert.deepEqual(filterUserActivity(null, "a@x.com"), []);
  });
});
