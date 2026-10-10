import { DatabaseSync } from "node:sqlite";
import { chmodSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

const databaseKey = Symbol.for("miova.selfhost.sqlite-d1.v1");

function normalizeBinding(value) {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("SQLite bindings must be strings, finite numbers, null, or byte buffers.");
}

/** A deliberately small D1-compatible interface, backed by one real SQLite connection. */
export function createSqliteD1(database) {
  const statements = new WeakMap();
  let closed = false;

  function assertOpen() {
    if (closed) throw new Error("selfhost_database_closed");
  }

  function prepare(sql, bindings = []) {
    assertOpen();
    if (typeof sql !== "string" || !sql.trim()) throw new TypeError("Expected non-empty SQL.");
    const execute = (arrayRows = false) => {
      assertOpen();
      const started = performance.now();
      const before = database.prepare("SELECT total_changes() AS value").get().value;
      const compiled = database.prepare(sql);
      if (arrayRows) compiled.setReturnArrays(true);
      const results = compiled.all(...bindings);
      // These SELECTs do not change SQLite changes(): audit INSERT ... changes() remains correct.
      const after = database.prepare("SELECT total_changes() AS value").get().value;
      const state = database.prepare("SELECT changes() AS changes, last_insert_rowid() AS lastRowId").get();
      return {
        results,
        success: true,
        meta: {
          changes: after === before ? 0 : Number(state.changes),
          last_row_id: Number(state.lastRowId),
          duration: performance.now() - started,
        },
      };
    };
    const statement = Object.freeze({
      bind: (...values) => prepare(sql, values.map(normalizeBinding)),
      all: async () => execute(),
      run: async () => execute(),
      first: async (column) => {
        if (column !== undefined && typeof column !== "string") throw new TypeError("Expected a column name.");
        const row = execute().results[0] ?? null;
        if (column === undefined) return row;
        if (row === null) return null;
        if (!Object.hasOwn(row, column)) throw new Error("selfhost_column_not_found");
        return row[column];
      },
      raw: async (options = {}) => {
        if (!options || typeof options !== "object" || Array.isArray(options)
          || (options.columnNames !== undefined && typeof options.columnNames !== "boolean")) {
          throw new TypeError("Expected raw options with an optional boolean columnNames.");
        }
        const rows = execute(true).results;
        return options.columnNames ? [database.prepare(sql).columns().map((column) => column.name), ...rows] : rows;
      },
    });
    statements.set(statement, execute);
    return statement;
  }

  return Object.freeze({
    database,
    prepare,
    batch: async (input) => {
      assertOpen();
      if (!Array.isArray(input) || input.length === 0 || input.some((statement) => !statements.has(statement))) {
        throw new TypeError("A batch must contain statements from this SQLite connection.");
      }
      database.exec("BEGIN IMMEDIATE");
      try {
        // No await here: UPDATE and its changes()-based audit remain adjacent on one connection.
        const result = input.map((statement) => statements.get(statement)());
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => {
      if (!closed) {
        database.close();
        closed = true;
      }
    },
    isClosed: () => closed,
  });
}

/** Require an explicit ordinary file in an existing directory; never select a default production DB. */
export function openSqliteD1(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename)) throw new Error("selfhost_sqlite_path_must_be_absolute");
  const resolved = path.resolve(filename);
  const parent = realpathSync(path.dirname(resolved));
  const canonical = path.join(parent, path.basename(resolved));
  const existing = lstatSync(canonical, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("selfhost_sqlite_requires_regular_file");
  const database = new DatabaseSync(canonical, { enableForeignKeyConstraints: true, allowExtension: false });
  try {
    if (!existing && process.platform !== "win32") chmodSync(canonical, 0o600);
    database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;");
    return createSqliteD1(database);
  } catch (error) {
    database.close();
    throw error;
  }
}

/** Global identity survives separately bundled RSC/SSR imports, but cannot silently switch files. */
export function getSelfhostD1() {
  const filename = process.env.MIOVA_SQLITE_PATH?.trim();
  if (!filename || !path.isAbsolute(filename)) throw new Error("Configure an absolute MIOVA_SQLITE_PATH before opening the store.");
  const canonical = path.join(realpathSync(path.dirname(filename)), path.basename(filename));
  const current = globalThis[databaseKey];
  if (current && !current.adapter.isClosed()) {
    if (current.filename !== canonical) throw new Error("selfhost_sqlite_path_changed");
    return current.adapter;
  }
  const adapter = openSqliteD1(canonical);
  globalThis[databaseKey] = { filename: canonical, adapter };
  return adapter;
}

export function closeSelfhostD1() {
  globalThis[databaseKey]?.adapter.close();
  delete globalThis[databaseKey];
}
