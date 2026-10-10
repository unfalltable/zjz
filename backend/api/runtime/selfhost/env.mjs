import { getSelfhostD1 } from "./db.mjs";

// Accessing server-only environment strings is side-effect free. DB opens only when requested.
export const env = new Proxy(process.env, {
  get(target, property) {
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
