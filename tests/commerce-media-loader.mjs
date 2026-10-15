import { resolve as resolveCommerce, load } from "./commerce-admin-loader.mjs";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@backend/media-storage") return nextResolve(new URL("../backend/api/runtime/selfhost/media-storage.mjs", import.meta.url).href, context);
  return resolveCommerce(specifier, context, nextResolve);
}

export { load };
