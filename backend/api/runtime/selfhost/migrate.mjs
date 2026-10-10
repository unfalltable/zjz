import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultDirectory = fileURLToPath(new URL("../../../sql/", import.meta.url));
const reviewedTags = ["0000_sloppy_timeslip", "0001_silly_human_fly", "0002_commerce_foundation"];

function readOrdinaryFile(filename) {
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("selfhost_migration_requires_regular_file");
  return readFileSync(filename);
}

function readMigrations(directory) {
  const journal = JSON.parse(readOrdinaryFile(path.join(directory, "meta", "_journal.json")).toString("utf8"));
  if (!journal || journal.dialect !== "sqlite" || !Array.isArray(journal.entries)
    || journal.entries.length !== reviewedTags.length) throw new Error("selfhost_invalid_migration_journal");
  return journal.entries.map((entry, index) => {
    if (!entry || entry.idx !== index || entry.tag !== reviewedTags[index]) throw new Error("selfhost_unreviewed_migration");
    const bytes = readOrdinaryFile(path.join(directory, `${entry.tag}.sql`));
    const sql = bytes.toString("utf8");
    if (!sql.trim()) throw new Error("selfhost_empty_migration");
    return { idx: index, tag: entry.tag, sql, hash: createHash("sha256").update(bytes).digest("hex") };
  });
}

/** Explicit all-or-nothing startup migration. Never reads MySQL account SQL or inserts shop seed data. */
export function migrateSelfhostDatabase(adapter, { directory = defaultDirectory } = {}) {
  const migrations = readMigrations(path.resolve(directory));
  if (!adapter?.database || adapter.isClosed()) throw new Error("selfhost_database_unavailable");
  const database = adapter.database;
  database.exec("BEGIN IMMEDIATE");
  try {
    const hasJournal = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = '_miova_migrations'").get();
    if (!hasJournal) {
      const existing = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
      if (existing) throw new Error("selfhost_untracked_database_requires_manual_review");
      database.exec(`CREATE TABLE _miova_migrations (
        idx INTEGER PRIMARY KEY, tag TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL
      )`);
    }
    const appliedRows = database.prepare("SELECT idx, tag, sha256 FROM _miova_migrations ORDER BY idx").all();
    if (appliedRows.length > migrations.length) throw new Error("selfhost_unknown_applied_migration");
    for (const [index, row] of appliedRows.entries()) {
      const expected = migrations[index];
      if (row.idx !== expected.idx || row.tag !== expected.tag || row.sha256 !== expected.hash) {
        throw new Error("selfhost_applied_migration_changed");
      }
    }
    const applied = [];
    for (const migration of migrations.slice(appliedRows.length)) {
      database.exec(migration.sql);
      database.prepare("INSERT INTO _miova_migrations (idx, tag, sha256, applied_at) VALUES (?, ?, ?, ?)")
        .run(migration.idx, migration.tag, migration.hash, new Date().toISOString());
      applied.push(migration.tag);
    }
    database.exec("COMMIT");
    return { applied, alreadyApplied: appliedRows.map((row) => row.tag) };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
