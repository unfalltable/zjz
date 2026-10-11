import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";
import { createDatabase, insertProduct } from "./commerce-db-fixture.mjs";
import { createD1Adapter } from "./commerce-d1-fixture.mjs";
import { env } from "./commerce-test-env.mjs";

register("./commerce-module-loader.mjs", import.meta.url);
const shipping = await import("../backend/api/db/shipping.ts");
const links = await import("../shared/shipping.ts");
const shippingHttp = await import("../backend/api/http/shipping.ts");
const checkout = await import("../backend/api/services/checkout.ts");
const owner = "shipping-owner";
const carrierInput = (overrides = {}) => ({ code: "postal", name: "Postal Carrier",
  trackingUrlTemplate: "https://tracking.example.com/parcel/{trackingNumber}", enabled: true,
  expectedVersion: -1, ...overrides });
const ruleInput = (overrides = {}) => ({ id: randomUUID(), name: "North America Standard",
  method: "standard", countries: ["US", "CA"], baseCents: 700, includedWeightGrams: 500,
  stepWeightGrams: 500, stepCents: 250, freeAboveCents: 7500, minDays: 7, maxDays: 14,
  carrierCode: null, enabled: true, expectedVersion: -1, ...overrides });
const quoteInput = (overrides = {}) => ({ country: "US", method: "standard", subtotalCents: 2000,
  weightGrams: 500, ...overrides });
const checkoutInput = (overrides = {}) => ({
  idempotencyKey: randomUUID(), email: "buyer@example.com", firstName: "Test", lastName: "Buyer",
  address: "1 Test Street", apartment: "", city: "Test City", region: "CA", postal: "12345",
  phone: "+15555550100", destination: "US", deliveryMethod: "standard", marketingOptIn: false,
  website: "", items: [{ id: "shipping-item", quantity: 1 }], ...overrides,
});
async function isolated(work) {
  const database = createDatabase();
  env.DB = createD1Adapter(database);
  env.STORE_OWNER_ID = owner;
  try { await work(database); }
  finally { delete env.DB; delete env.STORE_OWNER_ID; database.close(); }
}
function stockItem(database, overrides = {}) {
  insertProduct(database, { owner_id: owner, sku: "WEIGHT-01", storefront_id: "shipping-item",
    name: "Weighted product", price_cents: 2100, category: "home", image: "/products/kumo.webp",
    status: "active", stock: 10, reserved: 0, shipping_weight_grams: 1250, ...overrides });
}

test("shipping stays backward-compatible only until the merchant configures a real rule", async () => isolated(async () => {
  assert.equal((await shipping.getShippingSettings(owner)).configured, false);
  assert.equal((await shipping.quoteShipping(owner, quoteInput())).shippingCents, 890);
  assert.equal((await shipping.quoteShipping(owner, quoteInput({ subtotalCents: 7500 }))).shippingCents, 0);
  assert.equal((await shipping.quoteShipping(owner, quoteInput({ method: "express" }))).shippingCents, 1890);
  const rule = ruleInput({ countries: ["US"], enabled: false });
  assert.equal(await shipping.saveShippingRule(owner, rule), true);
  const disabled = await shipping.quoteShipping(owner, quoteInput());
  assert.equal(disabled.available, false);
  assert.equal(disabled.reason, "route_disabled");
  const uncovered = await shipping.quoteShipping(owner, quoteInput({ country: "CA" }));
  assert.equal(uncovered.reason, "country_not_served");
  assert.equal(uncovered.shippingCents, null);
  assert.equal((await shipping.quoteShipping(owner, quoteInput({ method: "priority" }))).available, false);
}));

test("configured rates use integer cents, rounded weight increments and exact free-shipping thresholds", async () => isolated(async () => {
  await shipping.saveShippingRule(owner, ruleInput());
  for (const [weightGrams, expected] of [[1, 700], [500, 700], [501, 950], [1000, 950], [1001, 1200]]) {
    const quote = await shipping.quoteShipping(owner, quoteInput({ weightGrams }));
    assert.equal(quote.shippingCents, expected, String(weightGrams));
    assert.equal(quote.minDays, 7);
    assert.equal(quote.maxDays, 14);
  }
  assert.equal((await shipping.quoteShipping(owner, quoteInput({ subtotalCents: 7499 }))).shippingCents, 700);
  assert.equal((await shipping.quoteShipping(owner, quoteInput({ subtotalCents: 7500, weightGrams: 1001 }))).shippingCents, 0);
  assert.equal((await shipping.quoteShipping(owner, quoteInput({ subtotalCents: 10000, country: "DE" }))).available, false);
}));

test("carrier settings and safe tracking URL generation are tenant-isolated and can be disabled", async () => isolated(async (database) => {
  assert.equal(await shipping.saveCarrier(owner, carrierInput()), true);
  const rule = ruleInput({ carrierCode: "postal" });
  assert.equal(await shipping.saveShippingRule(owner, rule), true);
  assert.equal((await shipping.quoteShipping(owner, quoteInput())).available, true);
  assert.deepEqual(await shipping.resolveCarrierTracking(owner, "postal", "AB/C?D"), {
    code: "postal", name: "Postal Carrier", trackingUrl: "https://tracking.example.com/parcel/AB%2FC%3FD",
  });
  assert.equal(await shipping.resolveCarrierTracking("other-owner", "postal", "123"), null);
  assert.deepEqual((await shipping.getShippingSettings("other-owner")).rules, []);
  assert.deepEqual((await shipping.getShippingSettings("other-owner")).carriers, []);
  await assert.rejects(() => shipping.saveShippingRule("other-owner", ruleInput({ carrierCode: "postal" })), /shipping_carrier_unavailable/);
  assert.equal(await shipping.saveCarrier("other-owner", carrierInput({ name: "Another store carrier" })), true);
  assert.equal(await shipping.saveCarrier(owner, carrierInput({ expectedVersion: 0, enabled: false })), true);
  assert.equal((await shipping.quoteShipping(owner, quoteInput())).reason, "carrier_disabled");
  assert.equal(await shipping.resolveCarrierTracking(owner, "postal", "123"), null);
  assert.equal((await shipping.resolveCarrierTracking("other-owner", "postal", "123")).name, "Another store carrier");
  assert.equal(database.prepare("SELECT count(*) AS n FROM shipping_events WHERE owner_id = ?").get(owner).n, 3);
}));

test("unsafe tracking templates and invalid shipping configuration are rejected before writes", async () => isolated(async (database) => {
  const invalid = ["javascript:alert(1)", "http://example.com/{trackingNumber}", "https://user:password@example.com/{trackingNumber}",
    "https://localhost/{trackingNumber}", "https://127.0.0.1/{trackingNumber}", "https://[::1]/{trackingNumber}",
    "https://carrier.local/{trackingNumber}", "https://carrier.internal/{trackingNumber}",
    "https://example.com:8443/{trackingNumber}", "https://{trackingNumber}.example.com/",
    "https://example.com/{trackingNumber}/{trackingNumber}", "https://example.com/{trackingNumber}#script",
    "https://example.com/{unknown}/{trackingNumber}", "https://example.com/track", "https://example.com/\\{trackingNumber}"];
  for (const template of invalid) {
    assert.equal(links.isSafeTrackingUrlTemplate(template), false, template);
    await assert.rejects(() => shipping.saveCarrier(owner, carrierInput({ trackingUrlTemplate: template })), /invalid_shipping_carrier/);
  }
  assert.equal(links.isSafeTrackingUrlTemplate("https://www.ups.com/track?tracknum={trackingNumber}"), true);
  for (const changes of [{ baseCents: 1.5 }, { includedWeightGrams: -1 }, { stepWeightGrams: 0 },
    { freeAboveCents: 0 }, { maxDays: 2 }, { countries: ["CN"] }, { countries: ["US", "US"] }, { expectedVersion: -2 }]) {
    await assert.rejects(() => shipping.saveShippingRule(owner, ruleInput(changes)), /invalid_shipping_rule/);
  }
  assert.equal(database.prepare("SELECT count(*) AS n FROM shipping_events").get().n, 0);
}));

test("optimistic rule updates reject stale versions without changing country mappings or writing audit", async () => isolated(async (database) => {
  const original = ruleInput();
  assert.equal(await shipping.saveShippingRule(owner, original), true);
  assert.equal(await shipping.saveShippingRule(owner, { ...original, name: "Updated", countries: ["GB"], expectedVersion: 0 }), true);
  assert.equal(await shipping.saveShippingRule(owner, { ...original, name: "Stale", countries: ["AU"], expectedVersion: 0 }), false);
  assert.equal(await shipping.saveShippingRule("other-owner", { ...original, expectedVersion: 1 }), false);
  const row = (await shipping.getShippingSettings(owner)).rules[0];
  assert.equal(row.version, 1);
  assert.equal(row.name, "Updated");
  assert.deepEqual(row.countries, ["GB"]);
  assert.deepEqual(database.prepare("SELECT country FROM shipping_rule_countries").all().map(({ country }) => country), ["GB"]);
  assert.equal(database.prepare("SELECT count(*) AS n FROM shipping_events").get().n, 2);
}));

test("overlapping enabled routes roll back atomically and preserve earlier valid settings", async () => isolated(async (database) => {
  const first = ruleInput();
  const disabled = ruleInput({ name: "Disabled alternative", countries: ["US"], enabled: false });
  await shipping.saveShippingRule(owner, first);
  await shipping.saveShippingRule(owner, disabled);
  await assert.rejects(() => shipping.saveShippingRule(owner, ruleInput({ countries: ["CA"] })), /shipping_route_overlap/);
  await assert.rejects(() => shipping.saveShippingRule(owner, { ...disabled, expectedVersion: 0, enabled: true }), /shipping_route_overlap/);
  assert.equal(database.prepare("SELECT count(*) AS n FROM shipping_rules").get().n, 2);
  assert.equal(database.prepare("SELECT count(*) AS n FROM shipping_events").get().n, 2);
  assert.equal((await shipping.getShippingSettings(owner)).rules.find(({ id }) => id === disabled.id).version, 0);
  assert.equal((await shipping.quoteShipping(owner, quoteInput())).shippingCents, 700);
  // Disjoint regions and different service methods remain possible.
  assert.equal(await shipping.saveShippingRule(owner, ruleInput({ countries: ["GB", "DE"] })), true);
  assert.equal(await shipping.saveShippingRule(owner, ruleInput({ countries: ["US"], method: "express" })), true);
}));

test("simultaneous settings writes converge on one accepted optimistic update", async () => isolated(async (database) => {
  const rule = ruleInput();
  await shipping.saveShippingRule(owner, rule);
  const results = await Promise.all([
    shipping.saveShippingRule(owner, { ...rule, countries: ["GB"], expectedVersion: 0 }),
    shipping.saveShippingRule(owner, { ...rule, countries: ["AU"], expectedVersion: 0 }),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(database.prepare("SELECT count(*) AS n FROM shipping_rule_countries").get().n, 1);
  assert.equal(database.prepare("SELECT count(*) AS n FROM shipping_events").get().n, 2);
  await shipping.saveCarrier(owner, carrierInput());
  const carrierResults = await Promise.all([
    shipping.saveCarrier(owner, carrierInput({ name: "Version A", expectedVersion: 0 })),
    shipping.saveCarrier(owner, carrierInput({ name: "Version B", expectedVersion: 0 })),
  ]);
  assert.equal(carrierResults.filter(Boolean).length, 1);
}));

test("public quote endpoint uses live product weights and prices without exposing private settings", async () => isolated(async (database) => {
  stockItem(database);
  await shipping.saveShippingRule(owner, ruleInput({ carrierCode: null }));
  const params = new URLSearchParams({ country: "US", items: JSON.stringify([{ id: "shipping-item", quantity: 2, priceCents: 1, weightGrams: 1 }]) });
  const response = await shippingHttp.GET(new Request(`https://shop.example/api/v1/shipping?${params}`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.subtotalCents, 4200);
  assert.equal(body.weightGrams, 2500);
  assert.equal(body.quotes[0].shippingCents, 1700);
  assert.equal(body.quotes[0].ruleId, null);
  assert.equal(body.quotes[0].carrierCode, null);
  assert.equal(body.quotes[1].available, false);
  assert.match(body.revision, /^[a-f0-9]{64}$/);
  for (const key of ["ownerId", "carriers", "rules", "trackingUrlTemplate"]) assert.ok(!(key in body));
  assert.equal(response.headers.get("cache-control"), "no-store");
}));

test("quote endpoint rejects invalid, duplicate, out-of-stock and foreign-owned shopping bags", async () => isolated(async (database) => {
  stockItem(database, { stock: 1 });
  for (const params of [{ country: "CN", items: "[]" }, { country: "US", items: "{" },
    { country: "US", items: JSON.stringify([{ id: "shipping-item", quantity: 1 }, { id: "shipping-item", quantity: 1 }]) }]) {
    assert.equal((await shippingHttp.GET(new Request(`https://shop.example/api/v1/shipping?${new URLSearchParams(params)}`))).status, 400);
  }
  for (const quantity of [2, 10]) {
    const params = new URLSearchParams({ country: "US", items: JSON.stringify([{ id: "shipping-item", quantity }]) });
    assert.equal((await shippingHttp.GET(new Request(`https://shop.example/api/v1/shipping?${params}`))).status, 422);
  }
  env.STORE_OWNER_ID = "other-owner";
  const params = new URLSearchParams({ country: "US", items: JSON.stringify([{ id: "shipping-item", quantity: 1 }]) });
  assert.equal((await shippingHttp.GET(new Request(`https://shop.example/api/v1/shipping?${params}`))).status, 422);
}));

test("checkout totals are recomputed against saved settings and trusted product weights", async () => isolated(async (database) => {
  stockItem(database);
  await shipping.saveShippingRule(owner, ruleInput());
  const draft = await checkout.createPendingOrder(checkoutInput({ subtotalCents: 1, weightGrams: 1, shippingCents: 0 }));
  assert.equal(draft.ok, true);
  assert.equal(draft.totalCents, 2100 + 1200);
  const row = database.prepare("SELECT amount_cents, shipping_cents, payment_status FROM orders").get();
  assert.equal(row.shipping_cents, 1200);
  assert.equal(row.payment_status, "pending");
  const unavailable = await checkout.createPendingOrder(checkoutInput({ destination: "DE" }));
  assert.equal(unavailable.code, "shipping_unavailable");
  assert.equal(database.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
}));

test("changed shipping revision requires review but accepted same-intent retries retain the original snapshot", async () => isolated(async (database) => {
  stockItem(database);
  const rule = ruleInput();
  await shipping.saveShippingRule(owner, rule);
  const settings = await shipping.getShippingSettings(owner);
  const input = checkoutInput({ shippingRevision: settings.revision });
  const first = await checkout.createPendingOrder(input);
  assert.equal(first.ok, true);
  await shipping.saveShippingRule(owner, { ...rule, baseCents: 1700, expectedVersion: 0 });
  const retry = await checkout.createPendingOrder(input);
  assert.equal(retry.orderNumber, first.orderNumber);
  assert.equal(retry.totalCents, first.totalCents);
  const rejected = await checkout.createPendingOrder({ ...input, idempotencyKey: randomUUID() });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.code, "shipping_quote_changed");
  assert.equal(database.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
  const newRevision = (await shipping.getShippingSettings(owner)).revision;
  const changedIntent = await checkout.createPendingOrder({ ...input, shippingRevision: newRevision });
  assert.equal(changedIntent.code, "idempotency_conflict");
}));

test("corrupt carrier/rule configuration fails closed rather than showing fallback quotes", async () => isolated(async (database) => {
  await shipping.saveCarrier(owner, carrierInput());
  await shipping.saveShippingRule(owner, ruleInput());
  database.prepare("UPDATE shipping_carriers SET tracking_url_template = 'javascript:alert(1)' WHERE owner_id = ?").run(owner);
  await assert.rejects(() => shipping.quoteShipping(owner, quoteInput()), /shipping_configuration_invalid/);
}));
