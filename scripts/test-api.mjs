import assert from "node:assert/strict";

const base = new URL(process.env.MIOVA_TEST_API_URL || "http://localhost:5173");
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new Error("API smoke tests only write to a local server.");
const post = (path, data, headers = {}) => fetch(new URL(path, base), {
  method: "POST", headers: { "Content-Type": "application/json", ...headers },
  body: typeof data === "string" ? data : JSON.stringify(data),
});
const catalog = await fetch(new URL("/api/v1/catalog", base));
assert.equal(catalog.status, 200);
const data = await catalog.json();
assert.equal(data.payments.enabled, false);
assert.deepEqual(data.locales, ["en", "zh", "es"]);
assert.ok(data.products.length > 0);
assert.ok(data.products.every((product) => Number.isInteger(product.priceCents)));
assert.equal((await post("/api/v1/orders", {})).status, 422);
assert.equal((await post("/api/v1/orders", "{" )).status, 400);
assert.equal((await post("/api/v1/orders", {}, { Origin: "https://untrusted.example" })).status, 403);
assert.equal((await post("/api/v1/orders", {}, { "Content-Type": "text/plain" })).status, 415);
assert.equal((await post("/api/v1/orders", "x".repeat(33_000))).status, 413);

const input = {
  idempotencyKey: crypto.randomUUID(), email: "api-smoke@example.com",
  firstName: "Smoke", lastName: "Test", address: "1 Test Street", apartment: "",
  city: "Test City", region: "CA", postal: "12345", phone: "+15555550100",
  destination: "US", deliveryMethod: "standard", marketingOptIn: false, website: "",
  items: [{ id: data.products[0].id, quantity: 1 }],
};
assert.equal((await post("/api/v1/orders", { ...input, items: [...input.items, ...input.items] })).status, 422);
const first = await post("/api/v1/orders", input);
assert.equal(first.status, 200, await first.clone().text());
const receipt = await first.json();
assert.equal(receipt.ok, true);
assert.equal(receipt.paymentStatus, "pending");
assert.equal(receipt.totalCents, data.products[0].priceCents + (data.products[0].priceCents >= 7500 ? 0 : 890));
const retry = await (await post("/api/v1/orders", input)).json();
assert.equal(retry.orderNumber, receipt.orderNumber);
const tracking = await post("/api/v1/orders/track", { orderNumber: receipt.orderNumber, email: input.email });
assert.equal(tracking.status, 200);
const tracked = await tracking.json();
assert.equal(tracked.order.status, "payment_pending");
assert.equal(tracked.order.paymentStatus, "pending");
assert.ok(!("customerEmail" in tracked.order));
assert.ok(!("shippingAddress" in tracked.order));
assert.equal((await post("/api/v1/orders/track", { orderNumber: receipt.orderNumber, email: "wrong@example.com" })).status, 404);
console.log("API smoke checks passed: catalogue, request guards, pending order, idempotency, private tracking.");
