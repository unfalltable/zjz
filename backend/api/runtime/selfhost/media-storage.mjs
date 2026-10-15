import { constants } from "node:fs";
import { lstat, open, realpath, link, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { managedImageOwnerPrefix, isManagedProductImageForOwner } from "../../../../shared/assets.ts";
import { MediaStorageError } from "../../media-storage.ts";

export { MediaStorageError };
export const maxProductImageBytes = 10 * 1024 * 1024;
const maxPixels = 24_000_000;
const maxDimension = 8192;
const maxOutputDimension = 2400;

function invalidImage(message = "Use a valid, non-animated JPEG, PNG or WebP image.") {
  return new MediaStorageError("invalid_image", 422, message);
}

async function storageDirectory(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory) || directory !== path.resolve(directory) ||
    directory === path.parse(directory).root || /[\u0000-\u001f\u007f]/.test(directory)) {
    throw new MediaStorageError("storage_unavailable", 503, "Product image storage is not configured correctly.");
  }
  try {
    const stat = await lstat(directory);
    const canonical = await realpath(directory);
    const samePath = process.platform === "win32" ? canonical.toLowerCase() === directory.toLowerCase() : canonical === directory;
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath ||
      (process.platform !== "win32" && (stat.mode & 0o022))) throw new Error("unsafe_media_directory");
    return canonical;
  } catch {
    throw new MediaStorageError("storage_unavailable", 503, "Product image storage is unavailable. Contact the store administrator.");
  }
}

// No user-supplied pathname ever reaches sharp, and no original image bytes are published.
function sniffImage(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

function hasPngAnimation(bytes) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw invalidImage();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") return true;
    offset += length + 12;
    if (type === "IEND") break;
  }
  return false;
}

function hasWebpAnimation(bytes) {
  if (bytes.length < 12 || bytes.readUInt32LE(4) !== bytes.length - 8) throw invalidImage();
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset + 4);
    if (length > bytes.length - offset - 8) throw invalidImage();
    const type = bytes.toString("ascii", offset, offset + 4);
    if (type === "ANIM" || type === "ANMF" || (type === "VP8X" && length > 0 && (bytes[offset + 8] & 2))) return true;
    offset += 8 + length + (length % 2);
  }
  return false;
}

export async function saveProductImage(ownerId, input, contentType, directory) {
  const root = await storageDirectory(directory);
  if (!(input instanceof Uint8Array) || input.byteLength < 16) throw invalidImage();
  if (input.byteLength > maxProductImageBytes) throw new MediaStorageError("image_too_large", 413, "Each product image must be 10 MiB or smaller.");
  const source = Buffer.from(input);
  const expectedFormat = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[contentType];
  const format = sniffImage(source);
  if (!expectedFormat || format !== expectedFormat) throw invalidImage("The image contents do not match its JPEG, PNG or WebP file type.");
  if ((format === "png" && hasPngAnimation(source)) || (format === "webp" && hasWebpAnimation(source))) throw invalidImage();

  let output;
  try {
    const pipeline = sharp(source, { failOn: "warning", limitInputPixels: maxPixels, sequentialRead: true });
    const metadata = await pipeline.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height || metadata.width > maxDimension ||
      metadata.height > maxDimension || metadata.width * metadata.height > maxPixels || (metadata.pages ?? 1) !== 1) {
      throw invalidImage("Image dimensions must be at most 8192 pixels per side and 24 megapixels in total.");
    }
    // Orientation is applied before resizing; EXIF, GPS, comments and profiles are not retained.
    output = await pipeline.rotate().resize({ width: maxOutputDimension, height: maxOutputDimension,
      fit: "inside", withoutEnlargement: true }).webp({ quality: 85, effort: 4 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error instanceof MediaStorageError) throw error;
    throw invalidImage();
  }
  if (!output.data.length || output.data.length > maxProductImageBytes || output.info.format !== "webp") throw invalidImage();
  const filename = `${await managedImageOwnerPrefix(ownerId)}-${randomBytes(16).toString("hex")}.webp`;
  const final = path.join(root, filename);
  const temporary = path.join(root, `.${randomBytes(24).toString("hex")}.upload`);
  let handle;
  let published = false;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o640);
    await handle.writeFile(output.data);
    await handle.sync();
    await handle.close(); handle = undefined;
    // link creates the final immutable name atomically and never replaces an existing file.
    await link(temporary, final);
    published = true;
    await unlink(temporary);
    // POSIX directory fsync makes publication durable; Windows does not support opening a directory this way.
    if (process.platform !== "win32") {
      const directoryHandle = await open(root, constants.O_RDONLY);
      try { await directoryHandle.sync(); }
      finally { await directoryHandle.close(); }
    }
    return { url: `/media/${filename}`, width: output.info.width, height: output.info.height,
      bytes: output.data.length, contentType: "image/webp" };
  } catch {
    // A completed immutable file may remain after a fsync failure; no success is reported.
    throw new MediaStorageError("storage_unavailable", 503, "The product image could not be stored. Please try again.");
  } finally {
    await handle?.close().catch(() => {});
    if (!published) await unlink(temporary).catch(() => {});
  }
}

export async function readProductImage(ownerId, filename, directory) {
  if (typeof filename !== "string" || !(await isManagedProductImageForOwner(`/media/${filename}`, ownerId))) return null;
  const root = await storageDirectory(directory);
  let handle;
  try {
    const filenamePath = path.join(root, filename);
    const before = await lstat(filenamePath);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 16 || before.size > maxProductImageBytes) return null;
    handle = await open(filenamePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size) return null;
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size || sniffImage(bytes) !== "webp") return null;
    return { bytes: new Uint8Array(bytes), etag: `"${createHash("sha256").update(bytes).digest("hex")}"` };
  } catch (error) {
    if (["ENOENT", "ELOOP", "ENOTDIR"].includes(error.code)) return null;
    throw new MediaStorageError("storage_unavailable", 503, "Product image storage is temporarily unavailable.");
  } finally { await handle?.close().catch(() => {}); }
}
