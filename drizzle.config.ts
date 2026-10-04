import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./backend/sql",
  schema: "./backend/api/db/schema.ts",
  dialect: "sqlite",
});
