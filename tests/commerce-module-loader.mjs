import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = new URL("../", import.meta.url);

// Test-only resolution. Production Cloudflare bindings are never imported by Node tests.
export async function resolve(specifier, context, nextResolve) {
  let target;
  if (specifier === "cloudflare:workers") target = new URL("./commerce-test-env.mjs", import.meta.url);
  else if (specifier.startsWith("@backend/")) target = new URL(`backend/api/${specifier.slice(9)}`, root);
  else if (specifier.startsWith("@shared/")) target = new URL(`shared/${specifier.slice(8)}`, root);
  else if (specifier.startsWith(".") && context.parentURL?.startsWith(root.href)) target = new URL(specifier, context.parentURL);
  if (target) {
    for (const url of [target, new URL(`${target.href}.ts`), new URL(`${target.href}.mjs`), new URL(`${target.href}/index.ts`)]) {
      if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith(root.href) && url.endsWith(".ts")) {
    const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: fileURLToPath(url),
    }).outputText;
    return { format: "module", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
