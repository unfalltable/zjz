import { resolve as resolveCommerce, load } from "./commerce-module-loader.mjs";

// Exercise real commerce actions without loading production authentication or Next cache.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@backend/auth" || specifier === "next/cache") {
    return nextResolve(new URL("./commerce-admin-deps.mjs", import.meta.url).href, context);
  }
  return resolveCommerce(specifier, context, nextResolve);
}

export { load };
