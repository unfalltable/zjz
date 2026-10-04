import { spawn } from "node:child_process";
import { cpSync, existsSync, lstatSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");
const surfaceIndex = args.indexOf("--surface");
const surface = surfaceIndex >= 0 ? args.splice(surfaceIndex, 2)[1] : "web";
if (!["web", "admin"].includes(surface)) throw new Error("Expected web or admin surface.");
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const surfaceRoot = path.join(repositoryRoot, surface === "admin" ? "backend/backend_web" : "web");
const managedLinux = readExecutionProfile() === "managed-linux";
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
const child = spawn(process.execPath, [fileURLToPath(cli), command,
  ...(command === "dev" ? ["--port", surface === "web" ? "5173" : "5174"] : []), ...args], {
  cwd: surfaceRoot,
  stdio: "inherit",
  env: { ...process.env, MIOVA_SURFACE: surface },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code) => {
  if (code === 0 && command === "build" && surface === "web") {
    // Hosting consumes the root dist; the framework owns web/dist.
    const source = path.join(surfaceRoot, "dist");
    if (!existsSync(path.join(source, "server", "index.js"))) throw new Error("Missing Worker build.");
    const target = path.resolve(repositoryRoot, "dist");
    if (target !== path.join(repositoryRoot, "dist") || lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error("Unsafe build output path.");
    }
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
  }
  process.exitCode = code ?? 1;
});
