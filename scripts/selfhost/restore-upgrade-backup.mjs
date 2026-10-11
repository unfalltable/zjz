// Upgrade rollback only: the deploy script first stops both services and blocks writes.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, lstatSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
const [snapshot] = process.argv.slice(2);
const directory = "/srv/miova/data";
const database = path.join(directory, "commerce.sqlite");
if (!snapshot || path.dirname(path.resolve(snapshot)) !== `${directory}/backups` || !/^commerce-[A-Za-z0-9.-]+\.sqlite$/.test(path.basename(snapshot))) throw new Error("Invalid exact upgrade snapshot.");
for (const target of [directory, `${directory}/backups`]) {
  const stat = lstatSync(target); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe upgrade directory.");
}
for (const target of [snapshot, database]) {
  const stat = lstatSync(target); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe upgrade database.");
}
const check = new DatabaseSync(snapshot, { readOnly: true });
try { if (check.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("Invalid rollback snapshot."); }
finally { check.close(); }
const temporary = `${database}.restore-${crypto.randomUUID()}`;
copyFileSync(snapshot, temporary, 1); // COPYFILE_EXCL: never replace an existing recovery file.
const descriptor = openSync(temporary, "r+"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
// All paths are exact, validated siblings in the configured data directory. Preserve
// the failed database in a verified snapshot before invoking this utility.
for (const target of [`${database}-wal`, `${database}-shm`]) {
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("Unsafe SQLite sidecar.");
  if (stat) unlinkSync(target);
}
renameSync(temporary, database);
const parent = openSync(directory, "r"); try { fsyncSync(parent); } finally { closeSync(parent); }
console.log("Verified pre-upgrade database restored; failed-upgrade snapshot retained.");
