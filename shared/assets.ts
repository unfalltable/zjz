export const managedProductImagePattern = /^\/media\/[a-f0-9]{32}-[a-f0-9]{32}\.webp$/;

export function isManagedProductImage(value: string): boolean {
  return managedProductImagePattern.test(value);
}

/** Stable owner scope, without putting a merchant's raw account ID in public URLs. */
export async function managedImageOwnerPrefix(ownerId: string): Promise<string> {
  if (!ownerId || ownerId.length > 512 || /[\u0000-\u001f\u007f]/.test(ownerId)) throw new Error("invalid_media_owner");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`miova-product-media-v1:${ownerId}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function isManagedProductImageForOwner(value: string, ownerId: string): Promise<boolean> {
  return isManagedProductImage(value) && value.startsWith(`/media/${await managedImageOwnerPrefix(ownerId)}-`);
}

// Public image contract: HTTPS or a plain local product asset, never local path escapes.
export function isProductImage(value: string): boolean {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (value.startsWith("/")) return isManagedProductImage(value) || /^\/products\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpe?g|avif)$/i.test(value);
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
