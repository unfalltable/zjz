import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Read only ordinary files: a migration symlink must not publish an outside file. */
async function readBundleFile(filename) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Migration bundle requires regular files.");
  return readFile(filename);
}

async function requireDirectory(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Migration bundle requires ordinary directories.");
}

/**
 * Bundle the SQLite journal's explicit allowlist, never the whole SQL directory.
 * Validate/read every source before creating output; never delete or overwrite files.
 * @param {string} sourceDirectory
 * @param {string} destinationDirectory
 */
export async function bundleCommerceMigrations(sourceDirectory, destinationDirectory) {
  const source = path.resolve(sourceDirectory);
  const destination = path.resolve(destinationDirectory);
  if (source === destination || destination.startsWith(`${source}${path.sep}`)
    || source.startsWith(`${destination}${path.sep}`)) {
    throw new Error("Migration source and bundle destination must be separate directories.");
  }
  const meta = path.join(source, "meta");
  await requireDirectory(source);
  await requireDirectory(meta);
  const journalBytes = await readBundleFile(path.join(meta, "_journal.json"));
  const journal = JSON.parse(journalBytes.toString("utf8"));
  if (!journal || journal.dialect !== "sqlite" || typeof journal.version !== "string"
    || !Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error("Invalid SQLite migration journal.");
  }

  const tags = new Set();
  const files = [{ name: path.join("meta", "_journal.json"), bytes: journalBytes }];
  for (const [index, entry] of journal.entries.entries()) {
    // A strict ASCII basename excludes traversal, separators, encoded paths and Windows device names.
    const prefix = String(index).padStart(4, "0");
    if (!entry || entry.idx !== index || typeof entry.tag !== "string"
      || !/^\d{4}_[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.tag)
      || !entry.tag.startsWith(`${prefix}_`) || tags.has(entry.tag)
      || typeof entry.version !== "string" || typeof entry.breakpoints !== "boolean"
      || !Number.isSafeInteger(entry.when) || entry.when <= 0) {
      throw new Error("Invalid or duplicate migration journal entry.");
    }
    tags.add(entry.tag);
    const sqlName = `${entry.tag}.sql`;
    const sqlBytes = await readBundleFile(path.join(source, sqlName));
    if (!sqlBytes.toString("utf8").trim()) throw new Error("Migration SQL cannot be empty.");
    const snapshotName = `${prefix}_snapshot.json`;
    const snapshotBytes = await readBundleFile(path.join(meta, snapshotName));
    const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
    if (!snapshot || snapshot.dialect !== "sqlite" || typeof snapshot.version !== "string") {
      throw new Error("Invalid SQLite migration snapshot.");
    }
    files.push({ name: sqlName, bytes: sqlBytes }, {
      name: path.join("meta", snapshotName), bytes: snapshotBytes,
    });
  }

  try {
    await requireDirectory(destination);
    if ((await readdir(destination)).length !== 0) throw new Error("Migration bundle destination must be empty.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(path.join(destination, "meta"), { recursive: true });
  for (const file of files) await writeFile(path.join(destination, file.name), file.bytes, { flag: "wx" });
  return files.map(({ name }) => name);
}
