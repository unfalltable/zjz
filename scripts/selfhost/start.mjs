import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { getSelfhostD1, closeSelfhostD1 } from "../../backend/api/runtime/selfhost/db.mjs";
import { migrateSelfhostDatabase } from "../../backend/api/runtime/selfhost/migrate.mjs";

const args = process.argv.slice(2);
const index = args.indexOf("--surface");
const surface = index >= 0 ? args[index + 1] : process.env.APP_SURFACE ?? "web";
if (!["web", "admin"].includes(surface)) throw new Error("Invalid application surface.");
const port = Number(process.env.PORT ?? (surface === "admin" ? "3101" : "3100"));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid port.");
if (!process.env.STORE_OWNER_ID?.trim()) throw new Error("STORE_OWNER_ID is required.");
if (!process.env.MIOVA_SQLITE_PATH || !path.isAbsolute(process.env.MIOVA_SQLITE_PATH)) {
  throw new Error("MIOVA_SQLITE_PATH must be an absolute persistent database path.");
}
const publicUrl = new URL(process.env.STOREFRONT_URL ?? "https://150.158.141.45/");
if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password) {
  throw new Error("An HTTPS STOREFRONT_URL is required.");
}
if (surface === "admin" && (!process.env.MIOVA_ADMIN_USERNAME ||
  !/^[a-f0-9]{64}$/i.test(process.env.MIOVA_ADMIN_PASSWORD_SHA256 ?? "") || !process.env.MIOVA_ADMIN_EMAIL)) {
  throw new Error("Private administration authentication must be configured.");
}
// No public interface and no Sites identity trust. Nginx is the only public entry.
process.env.NODE_ENV = "production";
process.env.APP_SURFACE = surface;
process.env.MIOVA_RUNTIME = "node";
process.env.PAYMENTS_ENABLED = "false";
process.env.VINEXT_TRUSTED_HOSTS = surface === "web" ? publicUrl.host : "localhost:8081,127.0.0.1:8081";
process.env.VINEXT_TRUST_PROXY = "1";
const root = fileURLToPath(new URL("../../", import.meta.url));
const outDir = path.join(root, surface === "admin" ? "backend/backend_web" : "web", "dist-node");
if (!existsSync(path.join(outDir, "server/index.js"))) throw new Error("Run npm run build:selfhost first.");
const migration = migrateSelfhostDatabase(getSelfhostD1());
console.info(`Self-host ${surface}: migrations checked (${migration.applied.length} applied). Payments disabled.`);
// Read proxy env before importing Vinext; its trust settings are module constants.
const { startProdServer } = await import("vinext/server/prod-server");
const { server } = await startProdServer({ outDir, host: "127.0.0.1", port });
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => { closeSelfhostD1(); process.exit(1); }, 15_000).unref();
  server.close(() => { clearTimeout(timeout); closeSelfhostD1(); process.exit(0); });
  server.closeIdleConnections();
});
