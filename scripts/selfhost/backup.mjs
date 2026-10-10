import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, lstatSync, openSync, realpathSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function ordinaryPath(filename, type) {
  if (typeof filename !== "string" || !path.isAbsolute(filename)) {
    throw new Error(`backup_${type}_path_must_be_absolute`);
  }
  const resolved = path.resolve(filename);
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || (type === "database" ? !stat.isFile() : !stat.isDirectory())) {
    throw new Error(`backup_${type}_requires_ordinary_path`);
  }
  return realpathSync(resolved);
}

/** Make an online, consistent SQLite snapshot without copying a live WAL file. */
export function backupSelfhostDatabase({ database, directory }) {
  const source = ordinaryPath(database, "database");
  const destination = ordinaryPath(directory, "directory");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = path.join(destination, `commerce-${timestamp}-${randomUUID()}.sqlite`);
  const connection = new DatabaseSync(source, { readOnly: true, allowExtension: false });
  const previousMask = process.umask(0o077);
  try {
    connection.exec("PRAGMA busy_timeout = 15000;");
    connection.prepare("VACUUM INTO ?").run(filename);
  } finally {
    process.umask(previousMask);
    connection.close();
  }
  if (process.platform !== "win32") chmodSync(filename, 0o600);
  const verification = new DatabaseSync(filename, { readOnly: true, allowExtension: false });
  let valid;
  try {
    const checks = verification.prepare("PRAGMA quick_check").all();
    valid = checks.length === 1 && checks[0].quick_check === "ok";
  } finally {
    verification.close();
  }
  if (!valid) {
    // Preserve the failed snapshot for inspection. Never delete source data or
    // silently label a corrupt snapshot as a usable backup.
    renameSync(filename, `${filename}.failed`);
    throw new Error("backup_quick_check_failed_snapshot_preserved");
  }
  // Persist the snapshot before reporting success, including its directory
  // entry on Linux. The Windows test runner does not support directory fsync.
  for (const target of process.platform === "win32" ? [filename] : [filename, destination]) {
    const descriptor = openSync(target, target === filename ? "r+" : "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
  return { filename, verified: true };
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!new Set(["--database", "--directory"]).has(flag) || !args[index + 1]) {
      throw new Error("Usage: backup.mjs --database /absolute/commerce.sqlite --directory /absolute/backups");
    }
    const key = flag.slice(2);
    if (Object.hasOwn(options, key)) throw new Error("backup_duplicate_argument");
    options[key] = args[index + 1];
  }
  return options;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(backupSelfhostDatabase(parseArguments(process.argv.slice(2)))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "backup_failed");
    process.exitCode = 1;
  }
}
