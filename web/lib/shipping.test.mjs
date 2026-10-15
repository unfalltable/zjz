import assert from "node:assert/strict";
import { test } from "node:test";
import { availableShippingMethod, fetchShippingQuotes, reviewShippingQuote } from "./shipping.ts";

const revision = "a".repeat(64);
const items = [{ id: "variant-red", quantity: 2 }];
function fixture() {
  return { ok: true, apiVersion: "v1", country: "US", currency: "USD",
    subtotalCents: 6000, weightGrams: 1000, configured: true, revision,
    quotes: [{ available: true, country: "US", method: "express", revision,
      shippingCents: 1250, minDays: 3, maxDays: 5, ruleId: null, carrierCode: null, reason: null }] };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("shipping sends exact SKU quantities and returns the available server route", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const query = new URL(url, "http://localhost").searchParams;
    assert.equal(query.get("country"), "US");
    assert.deepEqual(JSON.parse(query.get("items")), items);
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    return json(fixture());
  });
  const quotes = await fetchShippingQuotes("US", items);
  assert.equal(quotes.subtotalCents, 6000);
  assert.deepEqual(quotes.quotes.map((quote) => quote.method), ["express"]);
});

test("shipping rejects inconsistent countries, revisions, routes, unsafe totals and inverted dates", async (t) => {
  const mutations = [
    (value) => { value.country = "CA"; },
    (value) => { value.quotes[0].country = "CA"; },
    (value) => { value.quotes[0].revision = "b".repeat(64); },
    (value) => { value.quotes.push({ ...value.quotes[0] }); },
    (value) => { value.subtotalCents = Number.MAX_SAFE_INTEGER + 1; },
    (value) => { value.quotes[0].shippingCents = null; },
    (value) => { value.quotes[0].maxDays = 2; },
  ];
  for (const mutate of mutations) {
    const payload = fixture(); mutate(payload);
    t.mock.method(globalThis, "fetch", async () => json(payload));
    await assert.rejects(fetchShippingQuotes("US", items));
    t.mock.restoreAll();
  }
});

test("a failed quote can be retried with a different available service", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    ++calls === 1 ? json({ ok: false }, 503) : json(fixture()));
  await assert.rejects(fetchShippingQuotes("US", items), /shipping_unavailable/);
  const result = await fetchShippingQuotes("US", items);
  assert.equal(calls, 2);
  assert.equal(result.quotes[0].method, "express");
});

test("an already cancelled quote never starts a request", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => json(fixture()));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchShippingQuotes("US", items, controller.signal), { name: "AbortError" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("cancellation while decoding prevents an old destination response from succeeding", async (t) => {
  let release;
  const payload = new Promise((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: () => payload }));
  const controller = new AbortController();
  const checked = assert.rejects(fetchShippingQuotes("US", items, controller.signal), { name: "AbortError" });
  await Promise.resolve();
  controller.abort();
  release(fixture());
  await checked;
});

test("a stalled shipping request times out and can be retried", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const checked = assert.rejects(fetchShippingQuotes("US", items), { name: "AbortError" });
  t.mock.timers.tick(15000);
  await checked;
  t.mock.method(globalThis, "fetch", async () => json(fixture()));
  assert.equal((await fetchShippingQuotes("US", items)).quotes[0].shippingCents, 1250);
});

test("a reviewed service may save only unchanged live totals, availability and delivery dates", () => {
  const reviewed = fixture();
  assert.equal(reviewShippingQuote(structuredClone(reviewed), reviewed, "express", 6000).status, "ready");
  for (const mutate of [
    (value) => { value.revision = "b".repeat(64); },
    (value) => { value.quotes[0].shippingCents += 1; },
    (value) => { value.quotes[0].minDays += 1; },
    (value) => { value.quotes[0].maxDays += 1; },
    (value) => { value.quotes[0].available = false; },
    (value) => { value.quotes = []; },
    (value) => { value.country = "CA"; },
  ]) {
    const latest = structuredClone(reviewed);
    mutate(latest);
    assert.equal(reviewShippingQuote(latest, reviewed, "express", 6000).status, "shipping_changed");
  }
  assert.equal(reviewShippingQuote(reviewed, null, "express", 6000).status, "price_changed");
  assert.equal(reviewShippingQuote({ ...reviewed, subtotalCents: 6001 }, reviewed, "express", 6000).status, "price_changed");
  assert.equal(reviewShippingQuote(reviewed, reviewed, "express", 5999).status, "price_changed");
});

test("free shipping is accepted at zero cents only for the exact reviewed available service", () => {
  const reviewed = fixture();
  reviewed.quotes[0].shippingCents = 0;
  const result = reviewShippingQuote(structuredClone(reviewed), reviewed, "express", 6000);
  assert.equal(result.status, "ready");
  assert.equal(result.quote.shippingCents, 0);
  assert.equal(reviewShippingQuote(reviewed, reviewed, "standard", 6000).status, "shipping_changed");
  const disabledReview = structuredClone(reviewed);
  disabledReview.quotes[0].available = false;
  assert.equal(reviewShippingQuote(reviewed, disabledReview, "express", 6000).status, "shipping_changed");
});

test("a disabled service falls back to an available option that still requires a new review", () => {
  const reviewed = fixture();
  const latest = fixture();
  latest.revision = "b".repeat(64);
  latest.quotes[0] = { ...latest.quotes[0], available: false, shippingCents: null, reason: "route_disabled" };
  latest.quotes.push({ ...fixture().quotes[0], method: "priority", shippingCents: 2000 });
  const selection = availableShippingMethod(latest, "express");
  assert.equal(selection, "priority");
  assert.equal(reviewShippingQuote(latest, reviewed, "express", 6000).status, "shipping_changed");
  assert.equal(reviewShippingQuote(latest, reviewed, selection, 6000).status, "shipping_changed");
  assert.equal(reviewShippingQuote(latest, latest, selection, 6000).status, "ready");
  assert.equal(availableShippingMethod(latest, "priority"), "priority");
});

test("no routes remain unavailable until a fresh request returns a restored service", async (t) => {
  const unavailable = fixture();
  unavailable.quotes = unavailable.quotes.map((quote) => ({
    ...quote, available: false, shippingCents: null, minDays: null, maxDays: null, reason: "route_disabled",
  }));
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => json(++requests === 1 ? unavailable : fixture()));
  const first = await fetchShippingQuotes("US", items);
  assert.equal(availableShippingMethod(first, "standard"), "standard");
  assert.equal(reviewShippingQuote(first, first, "express", 6000).status, "shipping_changed");
  const refreshed = await fetchShippingQuotes("US", items);
  assert.equal(availableShippingMethod(refreshed, "standard"), "express");
  assert.equal(reviewShippingQuote(refreshed, refreshed, "express", 6000).status, "ready");
  assert.equal(requests, 2);
});
