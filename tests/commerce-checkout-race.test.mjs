import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";
import { createDatabase, insertProduct } from "./commerce-db-fixture.mjs";
import { createD1Adapter } from "./commerce-d1-fixture.mjs";
import { env } from "./commerce-test-env.mjs";

register("./commerce-module-loader.mjs", import.meta.url);
const { createPendingOrder } = await import("../backend/api/services/checkout.ts");
const { getShippingSettings, saveShippingRule } = await import("../backend/api/db/shipping.ts");

const owner = "checkout-race-owner";
const checkoutInput = (overrides = {}) => ({
  idempotencyKey: randomUUID(), email: "buyer@example.com", firstName: "Test", lastName: "Buyer",
  address: "1 Test Street", apartment: "", city: "Test City", region: "CA", postal: "12345",
  phone: "+15555550100", destination: "US", deliveryMethod: "standard", marketingOptIn: false,
  website: "", items: [{ id: "race-item", quantity: 1 }],
  expectedSubtotalCents: 2100, expectedShippingCents: 700, ...overrides,
});
const shippingRule = () => ({
  id: randomUUID(), name: "Race test delivery", method: "standard", countries: ["US"],
  baseCents: 700, includedWeightGrams: 500, stepWeightGrams: 500, stepCents: 250,
  freeAboveCents: null, minDays: 7, maxDays: 14, carrierCode: null, enabled: true, expectedVersion: -1,
});

async function isolated(work) {
  // Use only migrated in-memory SQLite and the test env; never load production bindings.
  const database = createDatabase();
  const d1 = createD1Adapter(database);
  env.DB = d1;
  env.STORE_OWNER_ID = owner;
  try {
    insertProduct(database, { owner_id: owner, sku: "RACE-01", storefront_id: "race-item",
      name: "Race product", price_cents: 2100, category: "home", image: "/products/kumo.webp",
      status: "active", stock: 10, reserved: 0, shipping_weight_grams: 500 });
    const rule = shippingRule();
    assert.equal(await saveShippingRule(owner, rule), true);
    const shippingRevision = (await getShippingSettings(owner)).revision;
    await work({ database, d1, rule, shippingRevision });
  } finally {
    delete env.DB;
    delete env.STORE_OWNER_ID;
    database.close();
  }
}

function pauseFirstIdempotencyMiss(d1) {
  const paused = Promise.withResolvers();
  const resumed = Promise.withResolvers();
  let intercepted = false;
  env.DB = {
    ...d1,
    prepare(sql) {
      const idempotencyRead = /FROM orders\s+WHERE owner_id = \? AND idempotency_key = \?/i.test(sql);
      const wrap = (statement) => ({
        ...statement,
        bind: (...values) => wrap(statement.bind(...values)),
        first: async (...args) => {
          const row = await statement.first(...args);
          if (idempotencyRead) {
            if (!intercepted) {
              intercepted = true;
              assert.equal(row, null, "A must observe the missing order before B saves it");
              paused.resolve();
              await resumed.promise;
            }
          }
          return row;
        },
      });
      return wrap(d1.prepare(sql));
    },
  };
  return { paused: paused.promise, resume: () => resumed.resolve() };
}

function assertDraftCount(database, expected) {
  assert.equal(database.prepare("SELECT count(*) AS n FROM orders").get().n, expected);
  assert.equal(database.prepare("SELECT count(*) AS n FROM order_events WHERE event_type = 'draft_created'").get().n, expected);
}

async function interleave(context, acceptedInput, pendingInput, changeState) {
  const gate = pauseFirstIdempotencyMiss(context.d1);
  const pending = createPendingOrder(pendingInput);
  try {
    await gate.paused;
    const accepted = await createPendingOrder(acceptedInput);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    await changeState(context);
    gate.resume();
    const result = await pending;
    assertDraftCount(context.database, 1);
    assert.deepEqual({ ...context.database.prepare("SELECT reserved FROM products WHERE sku = 'RACE-01'").get() }, { reserved: 0 });
    return { accepted, result };
  } finally {
    gate.resume();
    await pending;
  }
}

const scenarios = [
  {
    name: "inventory reaches zero",
    change: ({ database }) => database.prepare("UPDATE products SET stock = 0 WHERE sku = 'RACE-01'").run(),
    status: 422, code: "item_unavailable",
  },
  {
    name: "product is unpublished",
    change: ({ database }) => database.prepare("UPDATE products SET status = 'paused' WHERE sku = 'RACE-01'").run(),
    status: 422, code: "item_unavailable",
  },
  {
    name: "shipping weight becomes invalid",
    change: ({ database }) => database.prepare("UPDATE products SET shipping_weight_grams = 1.5 WHERE sku = 'RACE-01'").run(),
    status: 422, code: "item_unavailable",
  },
  {
    name: "reviewed product price changes",
    change: ({ database }) => database.prepare("UPDATE products SET price_cents = 2200 WHERE sku = 'RACE-01'").run(),
    status: 409, code: "price_quote_changed",
  },
  {
    name: "reviewed shipping revision changes",
    change: ({ rule }) => saveShippingRule(owner, { ...rule, baseCents: 1700, expectedVersion: 0 }),
    status: 409, code: "shipping_quote_changed",
  },
  {
    name: "shipping becomes unavailable",
    withoutRevision: true,
    change: ({ rule }) => saveShippingRule(owner, { ...rule, enabled: false, expectedVersion: 0 }),
    status: 422, code: "shipping_unavailable",
  },
  {
    name: "reviewed shipping price changes",
    withoutRevision: true,
    change: ({ rule }) => saveShippingRule(owner, { ...rule, baseCents: 1700, expectedVersion: 0 }),
    status: 409, code: "shipping_quote_changed",
  },
];

for (const scenario of scenarios) {
  test(`same-intent interleaved retry returns B's original snapshot when ${scenario.name}`, { timeout: 10_000 }, async () => isolated(async (context) => {
    const input = checkoutInput(scenario.withoutRevision ? {} : { shippingRevision: context.shippingRevision });
    const { accepted, result } = await interleave(context, input, { ...input, email: " BUYER@EXAMPLE.COM " }, scenario.change);
    assert.deepEqual(result, accepted);
    assert.equal(result.totalCents, 2800);
    assert.deepEqual(result.routeModes, ["self"]);
  }));

  test(`unaccepted checkout still rejects when ${scenario.name}`, async () => isolated(async (context) => {
    const input = checkoutInput(scenario.withoutRevision ? {} : { shippingRevision: context.shippingRevision });
    await scenario.change(context);
    const result = await createPendingOrder(input);
    assert.equal(result.ok, false);
    assert.equal(result.status, scenario.status);
    assert.equal(result.code, scenario.code);
    assertDraftCount(context.database, 0);
  }));
}

for (const [name, changeIntent] of [
  ["address", (input) => ({ ...input, address: "2 Different Street" })],
  ["quantity", (input) => ({ ...input, items: [{ id: "race-item", quantity: 2 }] })],
  ["reviewed amounts", (input) => ({ ...input, expectedSubtotalCents: 2200 })],
  ["shipping revision", (input) => ({ ...input, shippingRevision: "0".repeat(64) })],
]) {
  test(`concurrent same-key different ${name} stays a conflict after inventory reaches zero`, { timeout: 10_000 }, async () => isolated(async (context) => {
    const input = checkoutInput({ shippingRevision: context.shippingRevision });
    const { accepted, result } = await interleave(context, input, changeIntent(input), scenarios[0].change);
    assert.equal(accepted.totalCents, 2800);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, "idempotency_conflict");
  }));
}
