import { fileURLToPath } from "node:url";
import path from "node:path";
import vinext from "vinext";
import type { UserConfig } from "vite";
import hostingConfig from "../.openai/hosting.json";
import { readExecutionProfile } from "../scripts/execution-profile.mjs";
import { sites } from "./sites-vite-plugin";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export async function createMiovaConfig(surface: "web" | "admin"): Promise<UserConfig> {
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const managedLinux = readExecutionProfile() === "managed-linux";
  if (process.env.MIOVA_RUNTIME === "node") {
    return {
      publicDir: path.join(repositoryRoot, "web", "public"),
      resolve: { tsconfigPaths: false, alias: {
        "cloudflare:workers": path.join(repositoryRoot, "backend/api/runtime/selfhost/env.mjs"),
        "@backend/auth": path.join(repositoryRoot, "backend/api/runtime/selfhost/auth.ts"),
        "@backend": path.join(repositoryRoot, "backend/api"),
        "@shared": path.join(repositoryRoot, "shared"),
        "@admin": path.join(repositoryRoot, "backend/backend_web"),
        "@": path.join(repositoryRoot, "web"),
      } },
      server: { fs: { allow: [repositoryRoot] } },
      // The existing Sites/Worker target remains unchanged below.
      plugins: [vinext(), {
        name: "miova-node-runtime-aliases",
        enforce: "post",
        // Vinext prepends the broad tsconfig @backend alias. Re-prepend exact
        // runtime aliases after its config hook; native tsconfig resolution is
        // disabled too, so a public Node build cannot silently use Sites auth.
        config: () => ({ resolve: { tsconfigPaths: false, alias: [
          { find: /^@backend\/auth$/, replacement: path.join(repositoryRoot, "backend/api/runtime/selfhost/auth.ts") },
          { find: /^cloudflare:workers$/, replacement: path.join(repositoryRoot, "backend/api/runtime/selfhost/env.mjs") },
        ] } }),
      }],
    };
  }
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    publicDir: path.join(repositoryRoot, "web", "public"),
    resolve: { alias: {
      "@backend": path.join(repositoryRoot, "backend", "api"),
      "@shared": path.join(repositoryRoot, "shared"),
      "@admin": path.join(repositoryRoot, "backend", "backend_web"),
      "@": path.join(repositoryRoot, "web"),
    } },
    server: {
      fs: { allow: [repositoryRoot] },
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      ...(process.env.CODEX_SANDBOX === "seatbelt" ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [vinext(), sites({ mockAuth: !managedLinux }), cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      inspectorPort: false,
      persistState: { path: path.join(repositoryRoot, ".wrangler", "state") },
      config: {
        main: "vinext/server/fetch-handler",
        vars: { APP_SURFACE: surface, ...(surface === "admin" && process.env.NODE_ENV !== "production"
          ? { STOREFRONT_URL: "http://localhost:5173/" } : {}) },
        compatibility_flags: ["nodejs_compat"],
        d1_databases: hostingConfig.d1 ? [{ binding: hostingConfig.d1,
          database_name: "site-creator-d1", database_id: "00000000-0000-4000-8000-000000000000" }] : [],
        r2_buckets: hostingConfig.r2 ? [{ binding: hostingConfig.r2, bucket_name: "site-creator-r2" }] : [],
      },
    })],
  };
}
