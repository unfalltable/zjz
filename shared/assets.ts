// Public image contract: HTTPS or a plain local product asset, never local path escapes.
export function isProductImage(value: string): boolean {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (value.startsWith("/")) return /^\/products\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpe?g|avif)$/i.test(value);
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
