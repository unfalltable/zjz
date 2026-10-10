import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bundleCommerceMigrations } from "../build/commerce-migration-bundle.mjs";

async function withFixture(work) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "commerce-bundle-test-"));
  const source = path.join(temporary, "sql");
  const destination = path.join(temporary, "bundle");
  const journal = { version: "7", dialect: "sqlite", entries: [
    { idx: 0, version: "6", when: 1000, tag: "0000_initial", breakpoints: true },
    { idx: 1, version: "6", when: 2000, tag: "0001_catalog", breakpoints: true },
  ] };
  await mkdir(path.join(source, "meta"), { recursive: true });
  const writeJournal = () => writeFile(path.join(source, "meta", "_journal.json"), JSON.stringify(journal));
  await writeJournal();
  for (const entry of journal.entries) {
    await writeFile(path.join(source, `${entry.tag}.sql`), `-- ${entry.tag}\nSELECT 1;\n`);
    await writeFile(path.join(source, "meta", `${String(entry.idx).padStart(4, "0")}_snapshot.json`),
      JSON.stringify({ version: "6", dialect: "sqlite", id: `snapshot-${entry.idx}` }));
  }
  try { await work({ source, destination, journal, writeJournal }); }
  finally {
    // The sole recursive removal is the exact, absolute mkdtemp path owned by this test.
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("commerce-bundle-test-"));
    await rm(temporary, { recursive: true, force: true });
  }
}

test("bundle allowlists journal SQL and matching metadata; excludes user SQL and unrelated files", async () => {
  await withFixture(async ({ source, destination }) => {
    await writeFile(path.join(source, "数据库SQL.sql"), "DO NOT EXECUTE MYSQL OR ACCOUNT SQL");
    await writeFile(path.join(source, "README.md"), "not a migration");
    await writeFile(path.join(source, "9999_unjournaled.sql"), "DO NOT EXECUTE");
    await writeFile(path.join(source, "meta", "9999_snapshot.json"), "{}");
    const files = await bundleCommerceMigrations(source, destination);
    assert.deepEqual(files.sort(), ["0000_initial.sql", "0001_catalog.sql",
      path.join("meta", "0000_snapshot.json"), path.join("meta", "0001_snapshot.json"),
      path.join("meta", "_journal.json")].sort());
    assert.deepEqual((await readdir(destination)).sort(), ["0000_initial.sql", "0001_catalog.sql", "meta"]);
    assert.deepEqual((await readdir(path.join(destination, "meta"))).sort(),
      ["0000_snapshot.json", "0001_snapshot.json", "_journal.json"]);
    for (const file of files) assert.deepEqual(await readFile(path.join(destination, file)), await readFile(path.join(source, file)));
    assert.equal(await readFile(path.join(source, "数据库SQL.sql"), "utf8"), "DO NOT EXECUTE MYSQL OR ACCOUNT SQL");
  });
});

test("repository journal bundles exactly its reviewed migrations and snapshots without executing SQL", async () => {
  await withFixture(async ({ destination }) => {
    const source = new URL("../backend/sql/", import.meta.url);
    const journal = JSON.parse(await readFile(new URL("meta/_journal.json", source), "utf8"));
    const expected = [path.join("meta", "_journal.json"), ...journal.entries.flatMap((entry) => [
      `${entry.tag}.sql`, path.join("meta", `${String(entry.idx).padStart(4, "0")}_snapshot.json`),
    ])].sort();
    const { fileURLToPath } = await import("node:url");
    assert.deepEqual((await bundleCommerceMigrations(fileURLToPath(source), destination)).sort(), expected);
    assert.ok(!expected.some((name) => name.includes("数据库SQL") || name.includes("README")));
  });
});

test("unsafe, duplicate and inconsistent journal tags fail before creating output", async () => {
  for (const tag of ["../outside", "0001_../outside", "0001_/outside", "0001_\\outside", "0001_%2e%2e", "0000_initial", "0002_wrong_index", "数据库SQL"]) {
    await withFixture(async ({ source, destination, journal, writeJournal }) => {
      journal.entries[1].tag = tag;
      await writeJournal();
      await assert.rejects(bundleCommerceMigrations(source, destination), /journal entry/);
      await assert.rejects(readdir(destination), { code: "ENOENT" });
    });
  }
});

test("missing or empty referenced SQL and missing snapshots fail closed", async () => {
  for (const corruption of ["missing-sql", "empty-sql", "missing-snapshot", "invalid-snapshot"]) {
    await withFixture(async ({ source, destination }) => {
      if (corruption === "missing-sql") await rm(path.join(source, "0001_catalog.sql"));
      if (corruption === "empty-sql") await writeFile(path.join(source, "0001_catalog.sql"), " \n");
      if (corruption === "missing-snapshot") await rm(path.join(source, "meta", "0001_snapshot.json"));
      if (corruption === "invalid-snapshot") await writeFile(path.join(source, "meta", "0001_snapshot.json"), '{"dialect":"mysql","version":"6"}');
      await assert.rejects(bundleCommerceMigrations(source, destination));
      await assert.rejects(readdir(destination), { code: "ENOENT" });
    });
  }
});

test("missing source or journal cannot silently produce a migration-free release", async () => {
  await withFixture(async ({ source, destination }) => {
    await assert.rejects(bundleCommerceMigrations(path.join(source, "missing"), destination), { code: "ENOENT" });
    await rm(path.join(source, "meta", "_journal.json"));
    await assert.rejects(bundleCommerceMigrations(source, destination), { code: "ENOENT" });
    await assert.rejects(readdir(destination), { code: "ENOENT" });
  });
});

test("invalid journals fail closed and existing output is never overwritten or cleaned", async () => {
  for (const invalid of ["empty", "wrong-dialect", "duplicate-index", "bad-timestamp", "malformed"]) {
    await withFixture(async ({ source, destination, journal, writeJournal }) => {
      if (invalid === "empty") journal.entries = [];
      if (invalid === "wrong-dialect") journal.dialect = "mysql";
      if (invalid === "duplicate-index") journal.entries[1].idx = 0;
      if (invalid === "bad-timestamp") journal.entries[1].when = "yesterday";
      await writeJournal();
      if (invalid === "malformed") await writeFile(path.join(source, "meta", "_journal.json"), "not JSON");
      await assert.rejects(bundleCommerceMigrations(source, destination));
      await assert.rejects(readdir(destination), { code: "ENOENT" });
    });
  }
  await withFixture(async ({ source, destination }) => {
    await mkdir(destination);
    await writeFile(path.join(destination, "keep.sql"), "existing output");
    await assert.rejects(bundleCommerceMigrations(source, destination), /must be empty/);
    assert.equal(await readFile(path.join(destination, "keep.sql"), "utf8"), "existing output");
    assert.deepEqual(await readdir(destination), ["keep.sql"]);
    await assert.rejects(bundleCommerceMigrations(source, source), /separate directories/);
    await assert.rejects(bundleCommerceMigrations(source, path.join(source, "nested")), /separate directories/);
  });
});
