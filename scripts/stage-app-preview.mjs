import { cpSync, existsSync, lstatSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "app", "build", "web");
const target = path.resolve(root, "web", "public", "app-preview");
if (!existsSync(path.join(source, "index.html"))) throw new Error("Build Flutter web with --base-href /app-preview/ first.");
if (target !== path.join(root, "web", "public", "app-preview") || lstatSync(target, {throwIfNoEntry:false})?.isSymbolicLink()) throw new Error("Unsafe preview path.");
rmSync(target, {recursive:true,force:true});
cpSync(source, target, {recursive:true});
console.log("Flutter preview: http://localhost:5173/app-preview/index.html (start npm run dev:web).");
