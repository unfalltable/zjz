import { defineConfig } from "vite";
import { createMiovaConfig } from "../../build/miova-vite-config";
export default defineConfig(() => createMiovaConfig("admin"));
