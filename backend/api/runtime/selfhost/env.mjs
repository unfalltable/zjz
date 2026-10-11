import { getSelfhostD1 } from "./db.mjs";
import { existsSync } from "node:fs";
import path from "node:path";

// Accessing server-only environment strings is side-effect free. DB opens only when requested.
export const env = new Proxy(process.env, {
  get(target, property) {
    if (property === "MIOVA_MAINTENANCE") {
      const database = process.env.MIOVA_SQLITE_PATH;
      const lock = database && path.isAbsolute(database) ? path.join(path.dirname(database), "deployment.lock") : null;
      return process.env.MIOVA_MAINTENANCE === "true" || (lock && existsSync(lock)) ? "true" : "false";
    }
    return property === "DB" ? getSelfhostD1() : Reflect.get(target, property);
  },
  set(target, property, value) {
    if (property === "DB") throw new Error("selfhost_database_binding_is_read_only");
    return Reflect.set(target, property, value);
  },
  has(target, property) {
    return property === "DB" || Reflect.has(target, property);
  },
});
