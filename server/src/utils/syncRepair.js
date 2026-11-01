/**
 * Schema sync with a misdiagnosis-proof failure mode.
 *
 * Background: this project syncs with `{ alter: true }`, which only ever
 * adds/changes/removes COLUMNS on existing tables (plus at most the model's
 * own declared indexes — this codebase declares none beyond column-level
 * UNIQUEs). It can never create dozens of indexes by itself.
 *
 * MySQL error 1069 ("Too many keys specified; max 64 keys allowed") therefore
 * always means the TARGET TABLE ALREADY carries 64+ indexes from outside this
 * codebase (manual DDL, GUI tools, or an earlier schema iteration): MySQL
 * revalidates the whole index list on every ALTER, so even adding one column
 * is refused. It is unrelated to dotenv or the number of .env keys.
 *
 * syncSchema() syncs models one table at a time so a 1069 names its table,
 * then prints the exact DROP INDEX statements that repair that table (found
 * indexes minus the ones the model actually needs). The original error is
 * still rethrown — starting without the schema would only move the crash to
 * the first query — so the operator flow is: run the printed drops once,
 * restart, done.
 *
 * Self-heal: Sequelize re-issues CHANGE ... UNIQUE for UNIQUE columns on
 * every sync, and MySQL answers each re-issue with a NEW auto-suffixed
 * duplicate (tag_number_2, tag_number_3, ...) instead of replacing the old
 * one — so every `npm run dev` (and every --watch restart) adds one junk
 * index per UNIQUE column until the table hits 64 and all ALTERs die with
 * 1069. To stop the re-accumulation, syncSchema() prunes exact-duplicate
 * indexes BEFORE each model's sync: only provably redundant copies (same
 * columns in the same order, same uniqueness) are dropped, PRIMARY and the
 * canonical UNIQUEs always stay. Tables that are merely polluted (rather
 * than over the 64 limit) therefore heal silently on boot; tables already
 * at the limit are pruned first so the sync itself can then proceed.
 */

const MYSQL_TOO_MANY_KEYS = 1069;

/** True when err is (or wraps) MySQL error 1069. */
function isTooManyKeysError(err) {
  if (!err) return false;
  const codes = [err.errno, err.code, err.original?.errno, err.original?.code, err.parent?.errno, err.parent?.code];
  if (codes.some((c) => c === MYSQL_TOO_MANY_KEYS || c === "ER_TOO_MANY_KEYS")) return true;
  const text = `${err.message || ""} ${err.original?.message || ""} ${err.parent?.message || ""}`;
  return /too many keys specified/i.test(text);
}

/** Index names the model genuinely needs: PRIMARY + its UNIQUE columns/indexes. */
function essentialIndexNames(model) {
  const keep = new Set(["PRIMARY"]);
  const attrs = model?.rawAttributes || model?.tableAttributes || {};
  for (const attr of Object.values(attrs)) {
    if (attr && attr.unique) keep.add(attr.field || attr.fieldName);
  }
  for (const name of Object.keys(model?.options?.uniqueKeys || {})) keep.add(name);
  for (const index of model?._indexes || []) {
    if (index && index.name) keep.add(index.name);
  }
  return [...keep].filter(Boolean);
}

function tableNameOf(model) {
  if (typeof model?.getTableName === "function") {
    const name = model.getTableName();
    if (typeof name === "string") return name;
    if (name && typeof name.tableName === "string") return name.tableName;
  }
  return model?.name || "table";
}

function escapeIdent(value) {
  return String(value).replace(/`/g, "``");
}

/**
 * Build one-shot repair DDL from SHOW INDEX rows: every index EXCEPT the
 * essential ones becomes a DROP INDEX. Pure function (tested without a DB).
 */
function buildRepairStatements(tableName, indexRows, keepNames) {
  const keep = new Set(keepNames || []);
  const seen = new Set();
  const drops = [];
  for (const row of indexRows || []) {
    const name = row && (row.Key_name ?? row.key_name ?? row.name ?? row.index_name);
    if (!name || seen.has(name)) continue; // multi-column indexes repeat per column
    seen.add(name);
    if (!keep.has(name)) {
      drops.push(`ALTER TABLE \`${escapeIdent(tableName)}\` DROP INDEX \`${escapeIdent(name)}\`;`);
    }
  }
  return {
    tableName,
    total: seen.size,
    kept: [...seen].filter((name) => keep.has(name)),
    drops,
  };
}

function printRepairGuide(logger, { label, table, keep, repair, sql }) {
  logger.error(`[schema] ${label} (${table}) sync failed: MySQL error 1069 — this table already carries 64+ indexes, so MySQL refuses ANY further ALTER (even adding a column).`);
  logger.error(`[schema] This is pre-existing table state, not the model: the model declares ${keep.length} essential index(es) (${keep.join(", ")}). This error is unrelated to dotenv / .env keys.`);
  if (sql) logger.error(`[schema] Refused statement: ${sql}`);
  if (repair && repair.drops.length) {
    logger.error(`[schema] Found ${repair.total} index(es) on \`${repair.tableName}\`; keeping: ${repair.kept.join(", ") || "(none)"}.`);
    logger.error(`[schema] Run these ${repair.drops.length} statement(s) ONCE (mysql shell / Workbench), then restart the server:`);
    for (const stmt of repair.drops) logger.error(`[schema]   ${stmt}`);
  } else {
    logger.error(`[schema] Could not enumerate indexes automatically. Inspect with: SHOW INDEX FROM \`${escapeIdent(table)}\`;`);
    logger.error(`[schema] Then drop every index except ${keep.join(", ")} via: ALTER TABLE \`${escapeIdent(table)}\` DROP INDEX \`<name>\`; — then restart.`);
  }
}

/**
 * Normalize index listings into name -> { nonUnique, cols } regardless of
 * shape: raw SHOW INDEX rows (Key_name/Column_name/Seq_in_index/Non_unique,
 * one row per column) or Sequelize's grouped queryInterface.showIndex()
 * entries ({ name, unique, fields: [{ attribute }] }). Pure helper.
 */
function normalizeIndexEntries(indexRows) {
  const byName = new Map(); // name -> { nonUnique, cols: [[seq, column]] }
  for (const row of indexRows || []) {
    if (!row || typeof row !== "object") continue;
    if (Array.isArray(row.fields)) {
      const name = row.Key_name ?? row.key_name ?? row.name;
      const cols = row.fields
        .map((field) => (typeof field === "string" ? field : field?.attribute))
        .filter(Boolean)
        .map(String);
      if (name == null || !cols.length) continue;
      const nonUnique =
        row.unique === true ? 0 : row.unique === false ? 1 : Number(row.Non_unique ?? row.non_unique ?? 1);
      byName.set(String(name), { nonUnique, cols: cols.map((col, i) => [i + 1, col]) });
      continue;
    }
    const name = row.Key_name ?? row.key_name ?? row.name ?? row.index_name;
    const column = row.Column_name ?? row.column_name ?? row.column;
    if (name == null || column == null) continue;
    if (!byName.has(name)) {
      const flag = row.Non_unique ?? row.non_unique;
      byName.set(name, { nonUnique: flag === undefined ? 1 : Number(flag), cols: [] });
    }
    const entry = byName.get(name);
    const seq = Number(row.Seq_in_index ?? row.seq_in_index ?? entry.cols.length + 1);
    entry.cols.push([Number.isFinite(seq) ? seq : entry.cols.length + 1, String(column)]);
  }
  return byName;
}

/**
 * Find exact-duplicate indexes: same uniqueness flag and same columns in the
 * same order. Returns { drops, kept } as index-name lists; PRIMARY is never
 * dropped. Pure function (tested without a DB).
 */
function findRedundantIndexes(indexRows) {
  const byName = normalizeIndexEntries(indexRows);
  const groups = new Map(); // "nonUnique:col,..." -> [names]
  for (const [name, entry] of byName) {
    entry.cols.sort((a, b) => a[0] - b[0]);
    const key = `${entry.nonUnique}:${entry.cols.map(([, col]) => col).join(",")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(name);
  }
  const drops = [];
  const kept = [];
  for (const names of groups.values()) {
    if (names.length < 2) {
      kept.push(...names);
      continue;
    }
    // Keep the canonical copy: prefer the MySQL auto-name (first column),
    // else the shortest name, else lexicographically first. Deterministic.
    const firstCol = byName.get(names[0]).cols[0][1];
    const sorted = [...names].sort(
      (a, b) =>
        (b === firstCol) - (a === firstCol) || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0),
    );
    kept.push(sorted[0]);
    for (const name of sorted.slice(1)) {
      if (name !== "PRIMARY") drops.push(name);
      else kept.push(name);
    }
  }
  return { drops, kept };
}

/**
 * Pre-sync self-heal: drop exact-duplicate indexes so the 64-key ceiling is
 * never reached (and already-polluted tables unblock themselves). Best
 * effort: any failure is logged and the sync still runs, since only the sync
 * itself can report the authoritative schema state.
 */
async function pruneDuplicateIndexes(model, table, options = {}) {
  const { logger = console } = options;
  const label = model?.name || "model";
  try {
    const rows = await model.queryInterface.showIndex(table);
    const { drops, kept } = findRedundantIndexes(rows);
    if (!drops.length) return { pruned: [], kept };
    const quotedTable = `\`${escapeIdent(table)}\``;
    for (const name of drops) {
      await model.queryInterface.removeIndex(table, name);
    }
    logger.error(
      `[schema] ${label} (${quotedTable}): pruned ${drops.length} redundant duplicate index(es) ` +
        `(kept: ${kept.join(", ")}). These re-accumulate one-per-boot from UNIQUE re-sync; pruning keeps the table healthy.`,
    );
    return { pruned: drops, kept };
  } catch (err) {
    logger.error(`[schema] ${label} (${table}): duplicate-index pre-check skipped (${err?.message || err}); continuing to sync.`);
    return { pruned: [], kept: [] };
  }
}

/**
 * Sync models sequentially so a failure names its table. Each table is first
 * pruned of exact-duplicate indexes (self-heal against UNIQUE re-sync
 * accumulation); on 1069, prints the exact repair DDL, then rethrows the
 * ORIGINAL error (fail fast: starting without the schema would crash on the
 * first query instead).
 */
async function syncSchema(models, options = {}) {
  const { alter = true, logger = console } = options;
  for (const model of models || []) {
    const label = model?.name || "model";
    await pruneDuplicateIndexes(model, tableNameOf(model), { logger });
    try {
      await model.sync({ alter });
    } catch (err) {
      if (!isTooManyKeysError(err)) throw err;
      const table = tableNameOf(model);
      const keep = essentialIndexNames(model);
      let repair = null;
      try {
        const rows = await model.queryInterface.showIndex(table);
        repair = buildRepairStatements(table, rows, keep);
      } catch {
        repair = null; // fall through to generic guidance below
      }
      printRepairGuide(logger, {
        label,
        table,
        keep,
        repair,
        sql: err?.sql || err?.original?.sql || err?.parent?.sql || null,
      });
      throw err;
    }
  }
}

module.exports = {
  syncSchema,
  isTooManyKeysError,
  essentialIndexNames,
  buildRepairStatements,
  findRedundantIndexes,
  pruneDuplicateIndexes,
};
