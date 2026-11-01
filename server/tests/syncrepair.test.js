const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  syncSchema,
  isTooManyKeysError,
  essentialIndexNames,
  buildRepairStatements,
  findRedundantIndexes,
} = require("../src/utils/syncRepair");

describe("too-many-keys detection", () => {
  it("recognizes MySQL 1069 in all Sequelize wrapper shapes", () => {
    const msg = "Too many keys specified; max 64 keys allowed";
    assert.equal(isTooManyKeysError({ errno: 1069, message: msg }), true);
    assert.equal(isTooManyKeysError({ message: `SequelizeDatabaseError: ${msg}`, original: { errno: 1069 } }), true);
    assert.equal(isTooManyKeysError({ message: "other", parent: { code: "ER_TOO_MANY_KEYS" } }), true);
    assert.equal(isTooManyKeysError({ message: msg }), true);
  });

  it("rejects other failures and empty values", () => {
    assert.equal(isTooManyKeysError({ errno: 1062, message: "Duplicate entry" }), false);
    assert.equal(isTooManyKeysError({ code: "ECONNREFUSED", message: "connect" }), false);
    assert.equal(isTooManyKeysError(new Error("boom")), false);
    assert.equal(isTooManyKeysError(null), false);
    assert.equal(isTooManyKeysError(undefined), false);
  });
});

describe("essential index keep-set", () => {
  it("keeps PRIMARY plus each model's real UNIQUE columns", () => {
    // Real models, no DB connection needed for definitions.
    const { Animal, User, AlertSubscription } = require("../src/models");
    assert.deepEqual(essentialIndexNames(Animal).sort(), ["PRIMARY", "tag_number"]);
    assert.deepEqual(essentialIndexNames(User).sort(), ["PRIMARY", "email"]);
    assert.deepEqual(essentialIndexNames(AlertSubscription), ["PRIMARY"]);
  });

  it("tolerates missing models", () => {
    assert.deepEqual(essentialIndexNames(null), ["PRIMARY"]);
    assert.deepEqual(essentialIndexNames({}), ["PRIMARY"]);
  });
});

describe("repair statement builder", () => {
  it("drops every non-essential index exactly once", () => {
    const rows = [
      { Key_name: "PRIMARY" },
      { Key_name: "tag_number" },
      { Key_name: "stray_a" },
      { Key_name: "stray_b" },
      { Key_name: "stray_b" }, // multi-column indexes repeat per column
      { Key_name: "stray_c" },
    ];
    const out = buildRepairStatements("animals", rows, ["PRIMARY", "tag_number"]);
    assert.equal(out.total, 5);
    assert.deepEqual(out.kept.sort(), ["PRIMARY", "tag_number"]);
    assert.deepEqual(out.drops, [
      "ALTER TABLE `animals` DROP INDEX `stray_a`;",
      "ALTER TABLE `animals` DROP INDEX `stray_b`;",
      "ALTER TABLE `animals` DROP INDEX `stray_c`;",
    ]);
  });

  it("emits no drops when everything is essential or unknown", () => {
    assert.deepEqual(buildRepairStatements("animals", [{ Key_name: "PRIMARY" }], ["PRIMARY"]).drops, []);
    assert.deepEqual(buildRepairStatements("animals", [], ["PRIMARY"]).drops, []);
    assert.deepEqual(buildRepairStatements("animals", null, ["PRIMARY"]).drops, []);
  });

  it("escapes backticks in identifiers", () => {
    const out = buildRepairStatements("we`ird", [{ Key_name: "x`y" }], ["PRIMARY"]);
    assert.deepEqual(out.drops, ["ALTER TABLE `we``ird` DROP INDEX `x``y`;"]);
  });
});

describe("redundant duplicate finder", () => {
  const row = (Key_name, Column_name, Non_unique = 0, Seq_in_index = 1) => ({
    Key_name, Column_name, Non_unique, Seq_in_index,
  });

  it("keeps the canonical copy and drops auto-suffixed dupes", () => {
    const out = findRedundantIndexes([
      row("PRIMARY", "id"),
      row("tag_number", "tag_number"),
      row("tag_number_2", "tag_number"),
      row("tag_number_63", "tag_number"),
    ]);
    assert.deepEqual(out.drops.sort(), ["tag_number_2", "tag_number_63"]);
    assert.ok(out.kept.includes("PRIMARY"));
    assert.ok(out.kept.includes("tag_number"));
  });

  it("distinguishes multi-column order and uniqueness", () => {
    const out = findRedundantIndexes([
      row("ab1", "a"), row("ab1", "b", 0, 2),
      row("ab2", "a"), row("ab2", "b", 0, 2), // exact dupe -> dropped
      row("ba", "b"), row("ba", "a", 0, 2), // different order -> kept
      row("plain", "a", 1), // non-unique vs unique -> kept
      row("PRIMARY", "id"),
    ]);
    assert.deepEqual(out.drops, ["ab2"]);
    assert.ok(!out.drops.includes("PRIMARY"));
  });

  it("never drops PRIMARY and tolerates empty input", () => {
    assert.deepEqual(findRedundantIndexes([{ Key_name: "PRIMARY", Column_name: "id" }]).drops, []);
    assert.deepEqual(findRedundantIndexes([]).drops, []);
    assert.deepEqual(findRedundantIndexes(null).drops, []);
    assert.deepEqual(findRedundantIndexes([{ Key_name: "x" }]).drops, []);
  });

  it("handles Sequelize's grouped showIndex entries (real-world shape)", () => {
    // Exact shape returned by queryInterface.showIndex() on MySQL.
    const grouped = (name, unique, ...attrs) => ({
      primary: name === "PRIMARY",
      fields: attrs.map((attribute) => ({ attribute, length: undefined, order: "ASC" })),
      name,
      tableName: "animals",
      unique,
      type: "BTREE",
    });
    const out = findRedundantIndexes([
      grouped("PRIMARY", true, "id"),
      grouped("tag_number", true, "tag_number"),
      grouped("tag_number_2", true, "tag_number"),
      grouped("tag_number_63", true, "tag_number"),
    ]);
    assert.deepEqual(out.drops.sort(), ["tag_number_2", "tag_number_63"]);
    assert.ok(out.kept.includes("tag_number"));
  });
});

describe("syncSchema", () => {
  it("syncs every model with alter and preserves order", async () => {
    const calls = [];
    const fake = (name) => ({ name, sync: async (opts) => { calls.push([name, opts]); } });
    await syncSchema([fake("Animal"), fake("User")], { logger: { error: () => {} } });
    assert.deepEqual(calls, [
      ["Animal", { alter: true }],
      ["User", { alter: true }],
    ]);
  });

  it("rethrows non-1069 errors untouched without diagnostics", async () => {
    const boom = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const logged = [];
    const model = {
      name: "Animal",
      queryInterface: { showIndex: async () => [{ Key_name: "PRIMARY", Non_unique: 0, Column_name: "id" }] },
      sync: async () => { throw boom; },
    };
    await assert.rejects(
      syncSchema([model], { logger: { error: (m) => logged.push(m) } }),
      (err) => err === boom,
    );
    assert.equal(logged.length, 0);
  });

  it("prunes duplicates before syncing, and keeps syncing if pruning fails", async () => {
    const order = [];
    const removed = [];
    const model = {
      name: "Animal",
      getTableName: () => "animals",
      queryInterface: {
        // Grouped shape, as really returned by queryInterface.showIndex().
        showIndex: async () => [
          { primary: true, fields: [{ attribute: "id" }], name: "PRIMARY", tableName: "animals", unique: true },
          { primary: false, fields: [{ attribute: "tag_number" }], name: "tag_number", tableName: "animals", unique: true },
          { primary: false, fields: [{ attribute: "tag_number" }], name: "tag_number_2", tableName: "animals", unique: true },
        ],
        removeIndex: async (table, name) => { removed.push([table, name]); },
      },
      sync: async () => { order.push("sync"); },
    };
    const logged = [];
    order.push("start");
    await syncSchema([model], { logger: { error: (m) => logged.push(m) } });
    assert.deepEqual(removed, [["animals", "tag_number_2"]]);
    assert.deepEqual(order, ["start", "sync"]);
    assert.match(logged.join("\n"), /pruned 1 redundant duplicate/);

    // Prune failure degrades to a warning; the sync still runs.
    const order2 = [];
    const logged2 = [];
    const sick = {
      name: "User",
      queryInterface: { showIndex: async () => { throw new Error("gone"); } },
      sync: async () => { order2.push("sync"); },
    };
    await syncSchema([sick], { logger: { error: (m) => logged2.push(m) } });
    assert.deepEqual(order2, ["sync"]);
    assert.match(logged2.join("\n"), /pre-check skipped/);
  });

  it("prints exact repair DDL on 1069, then rethrows the original error", async () => {
    const err1069 = Object.assign(new Error("Too many keys specified; max 64 keys allowed"), {
      original: { errno: 1069, sql: "ALTER TABLE `animals` ADD COLUMN `x` JSON" },
    });
    const logged = [];
    const model = {
      name: "Animal",
      getTableName: () => "animals",
      rawAttributes: { tagNumber: { field: "tag_number", unique: true } },
      options: {},
      _indexes: [],
      queryInterface: {
        showIndex: async () => [
          { primary: true, fields: [{ attribute: "id" }], name: "PRIMARY", tableName: "animals", unique: true },
          { primary: false, fields: [{ attribute: "tag_number" }], name: "tag_number", tableName: "animals", unique: true },
          { primary: false, fields: [{ attribute: "marks" }], name: "stray_1", tableName: "animals", unique: false },
        ],
      },
      sync: async () => { throw err1069; },
    };
    await assert.rejects(
      syncSchema([model], { logger: { error: (m) => logged.push(m) } }),
      (err) => err === err1069,
    );
    const text = logged.join("\n");
    assert.match(text, /1069/);
    assert.match(text, /animals/);
    assert.match(text, /ALTER TABLE `animals` DROP INDEX `stray_1`;/);
    assert.match(text, /ADD COLUMN `x` JSON/);
    assert.doesNotMatch(text, /DROP INDEX `PRIMARY`/);
    assert.doesNotMatch(text, /DROP INDEX `tag_number`/);
  });

  it("falls back to generic guidance when index introspection fails", async () => {
    const err1069 = Object.assign(new Error("Too many keys specified; max 64 keys allowed"), {
      original: { errno: 1069 },
    });
    const logged = [];
    const model = {
      name: "Animal",
      getTableName: () => "animals",
      rawAttributes: {},
      options: {},
      _indexes: [],
      queryInterface: { showIndex: async () => { throw new Error("gone"); } },
      sync: async () => { throw err1069; },
    };
    await assert.rejects(
      syncSchema([model], { logger: { error: (m) => logged.push(m) } }),
      (err) => err === err1069,
    );
    assert.match(logged.join("\n"), /SHOW INDEX FROM `animals`/);
  });
});
