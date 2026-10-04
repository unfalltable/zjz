import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./backend/drizzle",
  schema: "./backend/db/schema.ts",
  dialect: "sqlite",
});
