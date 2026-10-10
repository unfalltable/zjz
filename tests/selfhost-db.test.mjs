import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { register } from "node:module";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeSelfhostD1, createSqliteD1, getSelfhostD1, openSqliteD1 } from "../backend/api/runtime/selfhost/db.mjs";
import { env } from "../backend/api/runtime/selfhost/env.mjs";
import { migrateSelfhostDatabase } from "../backend/api/runtime/selfhost/migrate.mjs";

const sourceSql = fileURLToPath(new URL("../backend/sql/", import.meta.url));
const tags = ["0000_sloppy_timeslip", "0001_silly_human_fly", "0002_commerce_foundation"];
function memory(t) {
  const adapter = createSqliteD1(new DatabaseSync(":memory:"));
  t.after(() => adapter.close());
  return adapter;
}
function temporaryDirectory(t, beforeCleanup = () => {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "miova-selfhost-test-"));
  t.after(() => {
    beforeCleanup();
    // Deletion is limited to this freshly created, exact fixture directory.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("miova-selfhost-test-"));
    rmSync(directory, { recursive: true });
  });
  return directory;
}
function migrationFixture(t) {
  const directory = temporaryDirectory(t);
  mkdirSync(path.join(directory, "meta"));
  copyFileSync(path.join(sourceSql, "meta", "_journal.json"), path.join(directory, "meta", "_journal.json"));
  for (const tag of tags) copyFileSync(path.join(sourceSql, `${tag}.sql`), path.join(directory, `${tag}.sql`));
  return directory;
}

test("SQLite D1 binds values and supports all/first/raw with accurate write metadata", async (t) => {
  const db = memory(t);
  db.database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT UNIQUE)");
  const statement = db.prepare("INSERT INTO items (value) VALUES (?)");
  const result = await statement.bind("one").run();
  assert.equal(result.success, true);
  assert.equal(result.meta.changes, 1);
  assert.equal(result.meta.last_row_id, 1);
  assert.equal((await db.prepare("SELECT * FROM items").all()).meta.changes, 0);
  assert.equal(await db.prepare("SELECT value FROM items").first("value"), "one");
  assert.equal(await db.prepare("SELECT value FROM items WHERE id = 99").first(), null);
  assert.deepEqual(await db.prepare("SELECT id, value FROM items").raw(), [[1, "one"]]);
  assert.deepEqual(await db.prepare("SELECT id, value FROM items").raw({ columnNames: true }), [["id", "value"], [1, "one"]]);
  assert.deepEqual(await db.prepare("SELECT id AS n, id + 1 AS n FROM items").raw(), [[1, 2]]);
  await assert.rejects(db.prepare("SELECT value FROM items").first("missing"), /column_not_found/);
  assert.equal((await statement.bind("one").all().catch(() => null)), null);
});

test("D1 write metadata handles comments/CTEs and no-op mutations without stale changes", async (t) => {
  const db = memory(t);
  db.database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");
  assert.equal((await db.prepare("-- create real row\nWITH data(value) AS (SELECT 'one') INSERT INTO items(value) SELECT value FROM data").run()).meta.changes, 1);
  assert.equal((await db.prepare("UPDATE items SET value='two' WHERE id=99").run()).meta.changes, 0);
  assert.equal((await db.prepare("INSERT INTO items(id,value) VALUES(1,'ignored') ON CONFLICT DO NOTHING").run()).meta.changes, 0);
  assert.equal((await db.prepare("SELECT changes()").all()).meta.changes, 0);
});

test("D1 batch keeps changes() auditing adjacent and rolls every write back on failure", async (t) => {
  const db = memory(t);
  db.database.exec("CREATE TABLE stock (id TEXT PRIMARY KEY, quantity INTEGER); CREATE TABLE audit (id TEXT PRIMARY KEY, quantity INTEGER); INSERT INTO stock VALUES ('real',5)");
  const update = () => db.prepare("UPDATE stock SET quantity=quantity+2 WHERE id='real'");
  const audit = (id) => db.prepare("INSERT INTO audit SELECT ?,quantity FROM stock WHERE id='real' AND changes()>0").bind(id);
  const result = await db.batch([update(), audit("first")]);
  assert.deepEqual(result.map((entry) => entry.meta.changes), [1, 1]);
  assert.equal(await db.prepare("SELECT quantity FROM stock").first("quantity"), 7);
  await assert.rejects(db.batch([update(), audit("first")]), /UNIQUE/);
  assert.equal(await db.prepare("SELECT quantity FROM stock").first("quantity"), 7);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM audit").first("n"), 1);
  await db.batch([db.prepare("UPDATE stock SET quantity=99 WHERE id='missing'"), audit("no-op")]);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM audit").first("n"), 1);
});

test("batch rejects forged/cross-connection statements before opening a transaction", async (t) => {
  const db = memory(t);
  const other = memory(t);
  await assert.rejects(db.batch([other.prepare("SELECT 1")]), /from this SQLite connection/);
  await assert.rejects(db.batch([{ execute() { throw new Error("must not execute"); } }]), /from this SQLite connection/);
  await assert.rejects(db.batch([]), /from this SQLite connection/);
  assert.equal(await db.prepare("SELECT 1 AS n").first("n"), 1);
});

test("bindings reject undefined, booleans and non-finite values but preserve bytes", async (t) => {
  const db = memory(t);
  for (const value of [undefined, true, NaN, Infinity, {}, []]) assert.throws(() => db.prepare("SELECT ?").bind(value), TypeError);
  const bytes = await db.prepare("SELECT ? AS bytes").bind(new Uint8Array([1, 2, 3])).first("bytes");
  assert.deepEqual([...bytes], [1, 2, 3]);
});

test("invalid result options are rejected before executing a mutation", async (t) => {
  const db = memory(t);
  db.database.exec("CREATE TABLE items(value TEXT)");
  const statement = db.prepare("INSERT INTO items(value) VALUES('must not write')");
  await assert.rejects(statement.first(123), TypeError);
  for (const options of [null, [], { columnNames: "true" }]) await assert.rejects(statement.raw(options), TypeError);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM items").first("n"), 0);
});

test("explicit reviewed migrations initialize a genuinely empty store and are idempotent", async (t) => {
  const db = memory(t);
  assert.deepEqual(migrateSelfhostDatabase(db), { applied: tags, alreadyApplied: [] });
  for (const table of ["products", "orders", "catalog_events", "inventory_events", "order_events"]) {
    assert.equal(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first("n"), 0);
  }
  assert.deepEqual(migrateSelfhostDatabase(db), { applied: [], alreadyApplied: tags });
  const rows = db.database.prepare("SELECT sha256 FROM _miova_migrations").all();
  assert.ok(rows.every((row) => /^[a-f0-9]{64}$/.test(row.sha256)));
});

test("migrator ignores MySQL and unlisted SQL rather than scanning a directory", async (t) => {
  const db = memory(t);
  const directory = migrationFixture(t);
  writeFileSync(path.join(directory, "数据库SQL.sql"), "THIS MYSQL MUST NEVER RUN");
  writeFileSync(path.join(directory, "0003_rogue.sql"), "CREATE TABLE rogue (id INTEGER)");
  migrateSelfhostDatabase(db, { directory });
  assert.equal(db.database.prepare("SELECT name FROM sqlite_schema WHERE name='rogue'").get(), undefined);
});

test("migrations fail closed on changed history without modifying data", async (t) => {
  const db = memory(t);
  const directory = migrationFixture(t);
  migrateSelfhostDatabase(db, { directory });
  db.database.prepare("INSERT INTO products(id,owner_id,sku,name,default_fulfillment,updated_at) VALUES ('real','owner','REAL-01','Real product','self','2026-10-10')").run();
  const filename = path.join(directory, `${tags[0]}.sql`);
  writeFileSync(filename, `${readFileSync(filename, "utf8")}\n-- changed history`);
  assert.throws(() => migrateSelfhostDatabase(db, { directory }), /applied_migration_changed/);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM products").first("n"), 1);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM _miova_migrations").first("n"), 3);
});

test("a migration SQL failure rolls back schema and journal creation together", (t) => {
  const db = memory(t);
  const directory = migrationFixture(t);
  writeFileSync(path.join(directory, `${tags[2]}.sql`), "CREATE TABLE partial (id INTEGER); INVALID SQL;");
  assert.throws(() => migrateSelfhostDatabase(db, { directory }), /syntax/);
  assert.equal(db.database.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='table'").get().n, 0);
});

test("migrator rejects unknown/reordered journal paths before touching the DB", (t) => {
  for (const mutate of [
    (journal) => { journal.entries[0].tag = "../../outside"; },
    (journal) => { journal.entries.reverse(); },
    (journal) => { journal.entries.push({ idx: 3, tag: "0003_new" }); },
    (journal) => { journal.dialect = "mysql"; },
  ]) {
    const db = memory(t);
    const directory = migrationFixture(t);
    const filename = path.join(directory, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(filename, "utf8"));
    mutate(journal);
    writeFileSync(filename, JSON.stringify(journal));
    assert.throws(() => migrateSelfhostDatabase(db, { directory }), /migration/);
    assert.equal(db.database.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='table'").get().n, 0);
  }
});

test("existing untracked databases require manual migration review", (t) => {
  const db = memory(t);
  db.database.exec("CREATE TABLE keep_me (id INTEGER); INSERT INTO keep_me VALUES(42)");
  assert.throws(() => migrateSelfhostDatabase(db), /untracked_database_requires_manual_review/);
  assert.equal(db.database.prepare("SELECT id FROM keep_me").get().id, 42);
  assert.equal(db.database.prepare("SELECT name FROM sqlite_schema WHERE name='_miova_migrations'").get(), undefined);
});

test("migration records must form the exact reviewed prefix", (t) => {
  const db = memory(t);
  migrateSelfhostDatabase(db);
  db.database.exec("DELETE FROM _miova_migrations WHERE idx=1");
  assert.throws(() => migrateSelfhostDatabase(db), /applied_migration_changed/);
});

test("production SQLite path is explicit; persistence survives close/reopen", async (t) => {
  let db;
  const directory = temporaryDirectory(t, () => db?.close());
  const filename = path.join(directory, "commerce.sqlite");
  assert.throws(() => openSqliteD1("relative.sqlite"), /must_be_absolute/);
  assert.throws(() => openSqliteD1(directory), /requires_regular_file/);
  db = openSqliteD1(filename);
  migrateSelfhostDatabase(db);
  db.database.exec("CREATE TABLE persistence_test(value TEXT); INSERT INTO persistence_test VALUES('real')");
  db.close();
  db = openSqliteD1(filename);
  t.after(() => db.close());
  assert.equal(await db.prepare("SELECT value FROM persistence_test").first("value"), "real");
  assert.deepEqual(migrateSelfhostDatabase(db), { applied: [], alreadyApplied: tags });
  assert.equal(await db.prepare("PRAGMA journal_mode").first("journal_mode"), "wal");
  assert.equal(await db.prepare("PRAGMA foreign_keys").first("foreign_keys"), 1);
});

test("Node env is lazy/dynamic and the global binding cannot silently switch databases", (t) => {
  const directory = temporaryDirectory(t, closeSelfhostD1);
  const filename = path.join(directory, "lazy.sqlite");
  const previous = process.env.MIOVA_SQLITE_PATH;
  const previousSurface = process.env.APP_SURFACE;
  closeSelfhostD1();
  t.after(() => {
    closeSelfhostD1();
    if (previous === undefined) delete process.env.MIOVA_SQLITE_PATH;
    else process.env.MIOVA_SQLITE_PATH = previous;
    if (previousSurface === undefined) delete process.env.APP_SURFACE;
    else process.env.APP_SURFACE = previousSurface;
  });
  delete process.env.MIOVA_SQLITE_PATH;
  process.env.APP_SURFACE = "web";
  assert.equal(env.APP_SURFACE, "web");
  assert.throws(() => env.DB, /Configure an absolute/);
  process.env.MIOVA_SQLITE_PATH = filename;
  assert.equal(existsSync(filename), false, "reading config did not create a DB");
  const db = env.DB;
  assert.ok(existsSync(filename));
  assert.equal(getSelfhostD1(), db);
  assert.equal(env.DB, db);
  process.env.APP_SURFACE = "admin";
  assert.equal(env.APP_SURFACE, "admin");
  process.env.MIOVA_SQLITE_PATH = path.join(directory, "other.sqlite");
  assert.throws(() => env.DB, /path_changed/);
  assert.equal(existsSync(process.env.MIOVA_SQLITE_PATH), false);
  assert.throws(() => { env.DB = db; }, /read_only/);
});

test("database handles refuse operations after close", async (t) => {
  const db = memory(t);
  const statement = db.prepare("SELECT 1 AS n");
  db.close();
  db.close();
  assert.throws(() => db.prepare("SELECT 1"), /closed/);
  await assert.rejects(statement.all(), /closed/);
});

test("production adapter works with real catalog, inventory and idempotent unpaid-order SQL", async (t) => {
  const db = memory(t);
  migrateSelfhostDatabase(db);
  // The test loader only resolves TypeScript/server aliases; DB is this production adapter.
  register("./commerce-module-loader.mjs", import.meta.url);
  const { env: testEnv } = await import("./commerce-test-env.mjs");
  const catalog = await import("../backend/api/db/catalog.ts");
  const ops = await import("../backend/api/db/ops.ts");
  const { createPendingOrder } = await import("../backend/api/services/checkout.ts");
  testEnv.DB = db;
  testEnv.STORE_OWNER_ID = "isolated-selfhost-owner";
  t.after(() => { delete testEnv.DB; delete testEnv.STORE_OWNER_ID; });
  const owner = testEnv.STORE_OWNER_ID;
  assert.deepEqual(await catalog.getStorefrontProducts(owner), []);
  assert.equal(await catalog.createCatalogProduct(owner, {
    sku: "REAL-01", storefrontId: "real-item", name: "Merchant-supplied item", priceCents: 1990,
    category: "home", image: "/products/kumo.webp", defaultFulfillment: "self",
  }), "created");
  assert.equal(await ops.addProductStock(owner, "REAL-01", 5, "isolated verification"), true);
  assert.equal(await catalog.updateCatalogProduct(owner, "REAL-01", { priceCents: 1990, status: "active", expectedVersion: 1 }), true);
  assert.equal((await catalog.getStorefrontProducts(owner)).length, 1);
  const checkout = {
    idempotencyKey: crypto.randomUUID(), email: "test@example.com", firstName: "Test", lastName: "Buyer",
    address: "1 Test Street", apartment: "", city: "Test City", region: "CA", postal: "12345",
    phone: "+15555550100", destination: "US", deliveryMethod: "standard", marketingOptIn: false,
    website: "", items: [{ id: "real-item", quantity: 1 }],
  };
  const results = await Promise.all(Array.from({ length: 4 }, () => createPendingOrder(checkout)));
  assert.ok(results.every((result) => result.ok && result.orderNumber === results[0].orderNumber));
  assert.equal(results[0].paymentStatus, "pending");
  assert.equal(await ops.setOrderStatus(owner, results[0].orderNumber, "purchase"), "unpaid");
  assert.equal(await db.prepare("SELECT count(*) AS n FROM orders").first("n"), 1);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM order_events").first("n"), 1);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM inventory_events").first("n"), 1);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM catalog_events").first("n"), 2);
  assert.equal(await db.prepare("SELECT stock FROM products").first("stock"), 5);
  assert.equal(await db.prepare("SELECT reserved FROM products").first("reserved"), 0);
});

test("production SQLite does not follow a database file symlink", { skip: process.platform === "win32" }, (t) => {
  const directory = temporaryDirectory(t);
  const original = path.join(directory, "real.sqlite");
  const link = path.join(directory, "link.sqlite");
  const db = openSqliteD1(original);
  db.close();
  symlinkSync(original, link);
  assert.throws(() => openSqliteD1(link), /requires_regular_file/);
});
