import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { backupSelfhostDatabase } from "../scripts/selfhost/backup.mjs";

const script = fileURLToPath(new URL("../scripts/selfhost/backup.mjs", import.meta.url));

function fixture(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "miova-backup-unit-"));
  const database = path.join(directory, "commerce.sqlite");
  const backups = path.join(directory, "backups");
  mkdirSync(backups);
  const writer = new DatabaseSync(database);
  try {
    writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE orders (id TEXT PRIMARY KEY, amount INTEGER NOT NULL);");
    writer.prepare("INSERT INTO orders VALUES (?, ?)").run("unpaid-draft", 4321);
    return run({ directory, database, backups, writer });
  } finally {
    writer.close();
    // Only the freshly created fixture directory is removed.
    rmSync(directory, { recursive: true });
  }
}

test("selfhost backup captures committed WAL data with a live writer and does not alter the store", () => {
  fixture(({ database, backups, writer }) => {
    const result = backupSelfhostDatabase({ database, directory: backups });
    assert.equal(result.verified, true);
    assert.equal(existsSync(result.filename), true);
    writer.prepare("INSERT INTO orders VALUES (?, ?)").run("later-draft", 5678);
    const snapshot = new DatabaseSync(result.filename, { readOnly: true });
    try {
      assert.equal(snapshot.prepare("PRAGMA quick_check").get().quick_check, "ok");
      assert.equal(snapshot.prepare("SELECT amount FROM orders WHERE id = ?").get("unpaid-draft").amount, 4321);
      assert.equal(snapshot.prepare("SELECT COUNT(*) AS count FROM orders").get().count, 1);
      assert.equal(writer.prepare("SELECT COUNT(*) AS count FROM orders").get().count, 2);
    } finally {
      snapshot.close();
    }
    if (process.platform !== "win32") assert.equal(lstatSync(result.filename).mode & 0o777, 0o600);
  });
});

test("selfhost backups use unique names and preserve existing backups", () => {
  fixture(({ database, backups }) => {
    const existingPath = path.join(backups, "existing.sqlite");
    const existing = new DatabaseSync(existingPath);
    existing.exec("CREATE TABLE preserved (value INTEGER); INSERT INTO preserved VALUES (9);");
    existing.close();
    const first = backupSelfhostDatabase({ database, directory: backups });
    const second = backupSelfhostDatabase({ database, directory: backups });
    assert.notEqual(first.filename, second.filename);
    assert.equal(path.dirname(first.filename), backups);
    assert.match(path.basename(first.filename), /^commerce-\d{4}-\d{2}-\d{2}T.*-[0-9a-f-]{36}\.sqlite$/);
    assert.equal(readdirSync(backups).length, 3);
    const preserved = new DatabaseSync(existingPath, { readOnly: true });
    try {
      assert.equal(preserved.prepare("SELECT value FROM preserved").get().value, 9);
    } finally {
      preserved.close();
    }
  });
});

test("selfhost backup rejects relative, missing, and wrong-type paths", () => {
  fixture(({ database, backups, directory }) => {
    assert.throws(() => backupSelfhostDatabase({ database: "commerce.sqlite", directory: backups }), /absolute/);
    assert.throws(() => backupSelfhostDatabase({ database, directory: "backups" }), /absolute/);
    assert.throws(() => backupSelfhostDatabase({ database: backups, directory: backups }), /ordinary/);
    assert.throws(() => backupSelfhostDatabase({ database, directory: database }), /ordinary/);
    assert.throws(() => backupSelfhostDatabase({ database, directory: path.join(directory, "missing") }), /ENOENT/);
    assert.deepEqual(readdirSync(backups), []);
  });
});

test("selfhost backup rejects direct source and destination symlinks", (context) => {
  fixture(({ database, backups, directory }) => {
    const alias = path.join(directory, "aliased.sqlite");
    try {
      symlinkSync(database, alias, "file");
    } catch (error) {
      if (process.platform === "win32" && error?.code === "EPERM") {
        context.skip("Windows symlink creation requires an elevated/developer-mode test runner");
        return;
      }
      throw error;
    }
    assert.throws(() => backupSelfhostDatabase({ database: alias, directory: backups }), /ordinary/);
    const backupAlias = path.join(directory, "aliased-backups");
    symlinkSync(backups, backupAlias, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => backupSelfhostDatabase({ database, directory: backupAlias }), /ordinary/);
  });
});

test("selfhost backup CLI succeeds with explicit paths and rejects duplicate flags", () => {
  fixture(({ database, backups }) => {
    const result = spawnSync(process.execPath, [script, "--database", database, "--directory", backups], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).verified, true);
    const before = readdirSync(backups);
    const invalid = spawnSync(process.execPath, [script, "--database", database, "--database", database], { encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /duplicate_argument/);
    assert.deepEqual(readdirSync(backups), before);
  });
});
