import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertMatchingFingerprint,
  availableInventory,
  calculateShipping,
  canonicalCheckoutRequest,
  checkoutRequestFingerprint,
  checkoutSchema,
  commerceOrderStatuses,
  IdempotencyConflictError,
  isValidPriceCents,
  legalNextStatuses,
  statusProgress,
  validateOrderTransition,
  validateStockAdjustment,
} from "../backend/api/domain/commerce.ts";

const checkout = (overrides = {}) => ({
  idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
  email: "buyer@example.com",
  firstName: "Alex", lastName: "Chen",
  address: "1 Test Street", apartment: "", city: "Test City", region: "CA",
  postal: "12345", phone: "+15555550100", destination: "US",
  deliveryMethod: "standard", marketingOptIn: false, website: "",
  items: [{ id: "one", quantity: 1 }, { id: "two", quantity: 2 }],
  ...overrides,
});
const parsed = (overrides = {}) => checkoutSchema.parse(checkout(overrides));

test("checkout normalizes whitespace and email case before binding intent", async () => {
  const normalized = parsed({ email: "  BUYER@EXAMPLE.COM  ", firstName: " Alex ", address: " 1 Test Street " });
  assert.equal(normalized.email, "buyer@example.com");
  assert.equal(normalized.firstName, "Alex");
  assert.equal(normalized.address, "1 Test Street");
  assert.equal(await checkoutRequestFingerprint(normalized), await checkoutRequestFingerprint(parsed()));
});

test("fingerprint is independent of cart ordering, unknown client prices, and idempotency UUID", async () => {
  const intent = parsed();
  const reordered = parsed({
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
    items: [...intent.items].reverse(),
    priceCents: 1,
    totalCents: 1,
  });
  const fingerprint = await checkoutRequestFingerprint(intent);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint, await checkoutRequestFingerprint(reordered));
  assert.equal(canonicalCheckoutRequest(intent), canonicalCheckoutRequest(reordered));
  assert.deepEqual(intent.items, [{ id: "one", quantity: 1 }, { id: "two", quantity: 2 }], "canonicalization must not mutate the cart");
});

test("every material checkout intent change requires a different fingerprint", async () => {
  const initial = await checkoutRequestFingerprint(parsed());
  for (const overrides of [
    { email: "other@example.com" }, { firstName: "Other" }, { lastName: "Other" },
    { address: "2 Test Street" }, { apartment: "A" }, { city: "Other City" },
    { region: "NY" }, { postal: "54321" }, { phone: "+15555550101" },
    { destination: "CA" }, { deliveryMethod: "express" }, { marketingOptIn: true },
    { items: [{ id: "one", quantity: 2 }, { id: "two", quantity: 2 }] },
    { items: [{ id: "other", quantity: 1 }] },
  ]) {
    assert.notEqual(await checkoutRequestFingerprint(parsed(overrides)), initial, JSON.stringify(overrides));
  }
});

test("idempotency rejects mismatched or unbound historical fingerprints", () => {
  assert.doesNotThrow(() => assertMatchingFingerprint("same", "same"));
  for (const stored of [null, "", "different"]) {
    assert.throws(() => assertMatchingFingerprint(stored, "same"), IdempotencyConflictError);
  }
});

test("checkout rejects bad quantities, duplicate IDs, unsupported destinations, and honeypot data", () => {
  for (const quantity of [0, -1, 1.5, 11, Infinity, NaN, "1"]) {
    assert.equal(checkoutSchema.safeParse(checkout({ items: [{ id: "one", quantity }] })).success, false);
  }
  for (const overrides of [
    { items: [] }, { items: [{ id: "one", quantity: 1 }, { id: " one ", quantity: 1 }] },
    { items: [{ id: "", quantity: 1 }] }, { items: Array.from({ length: 21 }, (_, i) => ({ id: `id-${i}`, quantity: 1 })) },
    { destination: "CN" }, { deliveryMethod: "teleport" }, { website: "bot" },
    { idempotencyKey: "not-a-uuid" }, { email: "not-email" },
  ]) assert.equal(checkoutSchema.safeParse(checkout(overrides)).success, false, JSON.stringify(overrides));
  assert.equal(checkoutSchema.safeParse(checkout({ items: [{ id: "one", quantity: 10 }] })).success, true);
});

test("available inventory subtracts reservations and fails closed for corrupt values", () => {
  assert.equal(availableInventory(42, 12), 30);
  assert.equal(availableInventory(4, 4), 0);
  assert.equal(availableInventory(4, 8), 0);
  for (const [stock, reserved] of [
    [-1, 0], [1, -1], [1.5, 0], [1, 0.5], [Infinity, 0], [NaN, 0],
    [Number.MAX_SAFE_INTEGER + 1, 0], [1, Number.MAX_SAFE_INTEGER + 1],
  ]) assert.equal(availableInventory(stock, reserved), 0);
});

test("merchant prices and restock adjustments have strict integer bounds", () => {
  assert.equal(isValidPriceCents(1), true);
  assert.equal(isValidPriceCents(100_000_000), true);
  for (const value of [null, "100", 0, -1, 1.5, Infinity, 100_000_001]) assert.equal(isValidPriceCents(value), false);
  assert.equal(validateStockAdjustment(1), true);
  assert.equal(validateStockAdjustment(1000, "x".repeat(200)), true);
  for (const quantity of [null, "1", 0, -1, 0.5, Infinity, 1001]) assert.equal(validateStockAdjustment(quantity), false);
  assert.equal(validateStockAdjustment(1, "x".repeat(201)), false);
  assert.equal(validateStockAdjustment(1, {}), false);
});

test("shipping uses integer cents and exact free-shipping boundary", () => {
  assert.equal(calculateShipping("standard", 7499), 890);
  assert.equal(calculateShipping("standard", 7500), 0);
  assert.equal(calculateShipping("express", 7500), 1890);
  assert.equal(calculateShipping("priority", 0), 3200);
  for (const cents of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculateShipping("standard", cents), /invalid_subtotal/);
  }
  assert.throws(() => calculateShipping("unknown", 100), /invalid_delivery_method/);
});

test("paid order status matrix permits only one forward step; no skipping or rewinding", () => {
  for (let from = 0; from < commerceOrderStatuses.length; from += 1) {
    for (let to = 0; to < commerceOrderStatuses.length; to += 1) {
      const expected = from === to ? "unchanged" : to === from + 1 ? "allowed" : "invalid_transition";
      assert.equal(validateOrderTransition(commerceOrderStatuses[from], commerceOrderStatuses[to], "paid"), expected);
    }
  }
  assert.equal(validateOrderTransition("missing", "purchase", "paid"), "invalid_transition");
  assert.equal(validateOrderTransition("purchase", "missing", "paid"), "invalid_transition");
  assert.equal(statusProgress.delivered, 100);
  assert.deepEqual(commerceOrderStatuses.map((status) => statusProgress[status]), [5, 22, 46, 70, 88, 100]);
});

test("pending, failed and refunded orders cannot enter or advance fulfillment", () => {
  for (const payment of ["pending", "failed", "refunded"]) {
    for (const current of commerceOrderStatuses) {
      for (const target of commerceOrderStatuses) {
        assert.equal(validateOrderTransition(current, target, payment), current === target ? "unchanged" : "unpaid");
      }
    }
  }
});

test("admin next-status options match the server state machine", () => {
  for (const status of commerceOrderStatuses) {
    for (const payment of ["pending", "paid", "failed", "refunded"]) {
      const expected = commerceOrderStatuses.filter((target) => validateOrderTransition(status, target, payment) === "allowed");
      assert.deepEqual(legalNextStatuses(status, payment), expected);
    }
  }
});
