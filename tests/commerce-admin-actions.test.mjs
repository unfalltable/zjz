import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { createDatabase, insertOrder } from "./commerce-db-fixture.mjs";
import { createD1Adapter } from "./commerce-d1-fixture.mjs";
import { env } from "./commerce-test-env.mjs";

register("./commerce-admin-loader.mjs", import.meta.url);
const {
  addStockAction, importProductsAction,
  saveProductAction, updateOrderStatusAction,
} = await import("../backend/backend_web/app/actions.ts");
const { initialOpsActionState } = await import("../backend/backend_web/app/action-state.ts");
const { lookupOrderAction } = await import("../web/app/track/actions.ts");
const { initialTrackState } = await import("../web/app/track/action-state.ts");

test("client-safe action states start idle without a false error or invented receipt", () => {
  assert.deepEqual(initialOpsActionState, { kind: "idle", message: "", eventId: 0 });
  assert.deepEqual(initialTrackState, { kind: "idle", message: "", order: null });
});

test("server action modules expose no runtime values that become client action stubs", async () => {
  for (const path of ["../backend/backend_web/app/actions.ts", "../web/app/track/actions.ts"]) {
    const actions = await import(path);
    for (const [name, value] of Object.entries(actions)) assert.equal(typeof value, "function", name);
  }
});

const owner = "isolated-admin-owner";
function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, String(value));
  return data;
}

function productForm(overrides = {}) {
  return form({
    mode: "create", sku: "ADMIN-01", storefrontId: "desk-organizer", name: "Desk Organizer",
    price: "19.90", compareAt: "29.90", category: "home", image: "https://cdn.example/item.webp",
    status: "active", defaultFulfillment: "self", color: "coral",
    badge_en: " Featured ", badge_zh: "", badge_es: "",
    description_en: " English description ", description_zh: "", description_es: "",
    detail_en: " English details ", detail_zh: "中文详情", detail_es: "",
    ...overrides,
  });
}

async function isolated(work) {
  const database = createDatabase();
  const d1 = createD1Adapter(database);
  env.DB = d1;
  env.STORE_OWNER_ID = owner;
  env.TEST_USER = { userId: owner, displayName: "Isolated test owner", email: "owner@example.com" };
  try { return await work(database, d1); }
  finally {
    delete env.DB;
    delete env.STORE_OWNER_ID;
    delete env.TEST_USER;
    database.close();
  }
}

test("real admin FormData creation includes metadata and starts paused with zero inventory", async () => isolated(async (database) => {
  const result = await saveProductAction(initialOpsActionState, productForm());
  assert.equal(result.kind, "success", result.message);
  const product = database.prepare("SELECT * FROM products").get();
  assert.equal(product.owner_id, owner);
  assert.equal(product.sku, "ADMIN-01");
  assert.equal(product.price_cents, 1990);
  assert.equal(product.compare_at_cents, 2990);
  assert.equal(product.status, "paused", "the submitted active state must not publish a new product");
  assert.equal(product.stock, 0);
  assert.equal(product.reserved, 0);
  assert.equal(product.version, 0);
  assert.deepEqual(JSON.parse(product.metadata_json), {
    color: "coral",
    badge: { en: "Featured", zh: "Featured", es: "Featured" },
    description: { en: "English description", zh: "English description", es: "English description" },
    detail: { en: "English details", zh: "中文详情", es: "English details" },
  });
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM orders").get().count, 0);
}));

test("admin product edit updates cents and multilingual copy without overwriting physical stock", async () => isolated(async (database) => {
  assert.equal((await saveProductAction(initialOpsActionState, productForm())).kind, "success");
  database.prepare("UPDATE products SET stock = 9, reserved = 2, inbound = 3").run();
  const result = await saveProductAction(initialOpsActionState, productForm({
    mode: "edit", expectedVersion: "0", price: "12.34", compareAt: "", status: "active",
    description_en: "Changed description", description_zh: "更新说明", detail_en: "Updated details",
  }));
  assert.equal(result.kind, "success", result.message);
  const product = database.prepare("SELECT * FROM products").get();
  assert.equal(product.price_cents, 1234);
  assert.equal(product.compare_at_cents, null);
  assert.equal(product.status, "active");
  assert.equal(product.stock, 9);
  assert.equal(product.reserved, 2);
  assert.equal(product.inbound, 3);
  assert.equal(product.version, 1);
  assert.deepEqual(JSON.parse(product.metadata_json).description, {
    en: "Changed description", zh: "更新说明", es: "Changed description",
  });
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 2);
}));

test("simultaneous stale admin forms cannot overwrite the winning product edit", async () => isolated(async (database) => {
  assert.equal((await saveProductAction(initialOpsActionState, productForm())).kind, "success");
  const results = await Promise.all([
    saveProductAction(initialOpsActionState, productForm({ mode: "edit", expectedVersion: "0", price: "21.01", description_en: "First writer" })),
    saveProductAction(initialOpsActionState, productForm({ mode: "edit", expectedVersion: "0", price: "22.02", description_en: "Second writer" })),
  ]);
  assert.deepEqual(results.map((result) => result.kind).sort(), ["error", "success"]);
  const product = database.prepare("SELECT price_cents, version, metadata_json FROM products").get();
  const winner = results[0].kind === "success" ? { cents: 2101, text: "First writer" } : { cents: 2202, text: "Second writer" };
  assert.equal(product.price_cents, winner.cents);
  assert.equal(JSON.parse(product.metadata_json).description.en, winner.text);
  assert.equal(product.version, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 2);
}));

test("duplicate admin SKU or storefront URL preserves the existing merchant product", async () => isolated(async (database) => {
  assert.equal((await saveProductAction(initialOpsActionState, productForm())).kind, "success");
  const original = database.prepare("SELECT * FROM products").get();
  for (const overrides of [{ name: "Overwrite attempt", price: "1.00" }, { sku: "ADMIN-02", name: "URL collision" }]) {
    assert.equal((await saveProductAction(initialOpsActionState, productForm(overrides))).kind, "error");
  }
  assert.deepEqual(database.prepare("SELECT * FROM products").get(), original);
  assert.equal(database.prepare("SELECT count(*) AS count FROM products").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 1);
}));

test("admin actions require the configured store owner before any data access or write", async () => isolated(async (_database, d1) => {
  for (const user of [null, { userId: "other-owner" }]) {
    env.TEST_USER = user;
    const results = await Promise.all([
      saveProductAction(initialOpsActionState, productForm()),
      importProductsAction(initialOpsActionState),
      addStockAction(initialOpsActionState, form({ sku: "ADMIN-01", quantity: "7", note: "" })),
      updateOrderStatusAction(initialOpsActionState, form({ orderNumber: "MW-12345678", status: "purchase" })),
    ]);
    assert.ok(results.every((result) => result.kind === "error"));
    assert.equal(d1.mutations(), 0);
  }
  env.TEST_USER = { userId: owner };
  delete env.STORE_OWNER_ID;
  assert.equal((await saveProductAction(initialOpsActionState, productForm())).kind, "error");
  assert.equal(d1.mutations(), 0);
}));

test("admin USD input converts whole, tenth and hundredth units to exact integer cents", async () => isolated(async (database) => {
  for (const [index, [price, cents]] of [["1", 100], ["0.01", 1], ["0.1", 10], ["29.99", 2999]].entries()) {
    const sku = `CENT-0${index}`;
    const result = await saveProductAction(initialOpsActionState, productForm({ sku, storefrontId: `cent-${index}`, price, compareAt: "" }));
    assert.equal(result.kind, "success", `${price}: ${result.message}`);
    assert.equal(database.prepare("SELECT price_cents FROM products WHERE sku = ?").get(sku).price_cents, cents);
  }
}));

test("admin invalid price and image inputs fail without creating products or audit records", async () => isolated(async (database, d1) => {
  for (const price of ["-1", "0", "0.00", "1.999", "1e2", "NaN", "1000000.01"]) {
    assert.equal((await saveProductAction(initialOpsActionState, productForm({ price }))).kind, "error", price);
  }
  for (const compareAt of ["19.90", "10.00", "0", "1.999"]) {
    assert.equal((await saveProductAction(initialOpsActionState, productForm({ compareAt }))).kind, "error", compareAt);
  }
  for (const image of ["javascript:alert(1)", "http://cdn.example/item.webp", "/ops", "//cdn.example/item.webp", "/products/../ops", "/products/%2e%2e/ops"]) {
    assert.equal((await saveProductAction(initialOpsActionState, productForm({ image }))).kind, "error", image);
  }
  assert.equal(d1.mutations(), 0);
  assert.equal(database.prepare("SELECT count(*) AS count FROM products").get().count, 0);
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 0);
}));

test("admin restock uses the entered quantity and trimmed note and keeps product content intact", async () => isolated(async (database) => {
  assert.equal((await saveProductAction(initialOpsActionState, productForm())).kind, "success");
  const metadata = database.prepare("SELECT metadata_json FROM products").get().metadata_json;
  const result = await addStockAction(initialOpsActionState, form({ sku: "ADMIN-01", quantity: "7", note: "  Actual warehouse receipt  " }));
  assert.equal(result.kind, "success", result.message);
  const product = database.prepare("SELECT stock, metadata_json, version FROM products").get();
  assert.equal(product.stock, 7);
  assert.equal(product.metadata_json, metadata);
  assert.equal(product.version, 1);
  const audit = database.prepare("SELECT * FROM inventory_events").get();
  assert.equal(audit.quantity, 7);
  assert.equal(audit.resulting_stock, 7);
  assert.equal(audit.note, "Actual warehouse receipt");
  assert.equal(audit.actor_id, owner);
  for (const quantity of ["0", "-1", "0.5", "1001"]) {
    assert.equal((await addStockAction(initialOpsActionState, form({ sku: "ADMIN-01", quantity, note: "" }))).kind, "error");
  }
  assert.equal(database.prepare("SELECT stock FROM products").get().stock, 7);
  assert.equal(database.prepare("SELECT count(*) AS count FROM inventory_events").get().count, 1);
}));

test("admin order action blocks fulfillment for unpaid drafts with no status or audit write", async () => isolated(async (database, d1) => {
  insertOrder(database, { owner_id: owner, order_number: "MW-12345678", payment_status: "pending", status: "payment_pending", progress: 5 });
  const result = await updateOrderStatusAction(initialOpsActionState, form({ orderNumber: "MW-12345678", status: "purchase", expectedVersion: "0" }));
  assert.equal(result.kind, "error");
  assert.match(result.message, /Payment must be completed/);
  const order = database.prepare("SELECT status, version, payment_status FROM orders").get();
  assert.deepEqual({ ...order }, { status: "payment_pending", version: 0, payment_status: "pending" });
  assert.equal(d1.mutations(), 0);
  assert.equal(database.prepare("SELECT count(*) AS count FROM order_events").get().count, 0);
}));

test("admin paid status action rejects skipping and stale revisions and audits one forward step", async () => isolated(async (database) => {
  insertOrder(database, { owner_id: owner, order_number: "MW-12345678" });
  assert.equal((await updateOrderStatusAction(initialOpsActionState, form({ orderNumber: "MW-12345678", status: "delivered", expectedVersion: "0" }))).kind, "error");
  const advanced = await updateOrderStatusAction(initialOpsActionState, form({ orderNumber: "MW-12345678", status: "packing", expectedVersion: "0" }));
  assert.equal(advanced.kind, "success", advanced.message);
  assert.equal((await updateOrderStatusAction(initialOpsActionState, form({ orderNumber: "MW-12345678", status: "handoff", expectedVersion: "0" }))).kind, "error");
  assert.deepEqual({ ...database.prepare("SELECT status, version FROM orders").get() }, { status: "packing", version: 1 });
  assert.equal(database.prepare("SELECT count(*) AS count FROM order_events").get().count, 1);
}));

test("admin explicit import is idempotent and never invents paid orders", async () => isolated(async (database) => {
  const first = await importProductsAction(initialOpsActionState);
  assert.equal(first.kind, "success", first.message);
  assert.match(first.message, /3 templates imported/);
  const second = await importProductsAction(initialOpsActionState);
  assert.equal(second.kind, "success", second.message);
  assert.match(second.message, /0 templates imported/);
  assert.equal(database.prepare("SELECT count(*) AS count FROM products").get().count, 3);
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 3);
  assert.equal(database.prepare("SELECT count(*) AS count FROM orders").get().count, 0);
  assert.ok(database.prepare("SELECT stock, status FROM products").all().every((product) => product.stock === 0 && product.status === "paused"));
}));

test("anonymous Web tracking action explicitly strips recipient fields from its runtime result", async () => isolated(async (database) => {
  insertOrder(database, {
    owner_id: owner, order_number: "MW-12345678", phone: "+15555550100",
    postal_code: "12345", shipping_address: "1 Private Street, Test City",
  });
  env.TEST_USER = null;
  const result = await lookupOrderAction(initialTrackState, form({ orderNumber: "MW-12345678", email: "buyer@example.com" }));
  assert.equal(result.kind, "found", result.message);
  assert.equal(result.order.orderNumber, "MW-12345678");
  for (const field of ["customerName", "customerEmail", "destination", "phone", "shippingAddress", "postalCode", "requestFingerprint", "lineItemsJson"]) {
    assert.equal(field in result.order, false, `${field} must not cross the public server-action boundary`);
  }
  const wrongEmail = await lookupOrderAction(initialTrackState, form({ orderNumber: "MW-12345678", email: "wrong@example.com" }));
  assert.equal(wrongEmail.kind, "not_found");
  env.STORE_OWNER_ID = "another-owner";
  const wrongStore = await lookupOrderAction(initialTrackState, form({ orderNumber: "MW-12345678", email: "buyer@example.com" }));
  assert.equal(wrongStore.kind, "not_found");
}));

test("admin creation and editing reject reserved product URLs without writes or audit events", async () => isolated(async (database, d1) => {
  const reserved = ["__proto__", "constructor", "prototype"];
  for (const storefrontId of reserved) {
    assert.equal((await saveProductAction(initialOpsActionState, productForm({ storefrontId }))).kind, "error", storefrontId);
  }
  assert.equal(d1.mutations(), 0);
  assert.equal(database.prepare("SELECT count(*) AS count FROM products").get().count, 0);
  assert.equal((await saveProductAction(initialOpsActionState, productForm())).kind, "success");
  const original = database.prepare("SELECT * FROM products").get();
  const mutations = d1.mutations();
  for (const storefrontId of reserved) {
    assert.equal((await saveProductAction(initialOpsActionState, productForm({ mode: "edit", expectedVersion: "0", storefrontId }))).kind, "error", storefrontId);
  }
  assert.deepEqual(database.prepare("SELECT * FROM products").get(), original);
  assert.equal(d1.mutations(), mutations);
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 1);
}));
