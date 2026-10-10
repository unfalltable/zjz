import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import {
  CHECKOUT_RETRY_STORAGE_KEY, clearCheckoutRetry, fetchLiveCatalog, parseCatalogResponse,
  parseShoppingBag, productQuantityLimit, readBrowserValue, reconcileShoppingBag, isSafeProductImage,
  retryKeyFor, shoppingBagNeedsReview, writeBrowserValue, markCheckoutAttempted, wasCheckoutAttempted,
} from "./storefront.ts";

const product = {
  id: "test-item", sku: "TEST-1", name: "Example product", price: 129, priceCents: 12900,
  compareAt: null, rating: 0, reviews: 0, category: "tech", image: "/products/nova.webp",
  color: "ice", inventory: 2, fulfillmentMode: "supplier",
  badge: { en: "", zh: "", es: "" }, description: { en: "Example", zh: "示例", es: "Ejemplo" },
  detail: { en: "Example", zh: "示例", es: "Ejemplo" },
};

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), values };
}
function browser() {
  const localStorage = memoryStorage(), sessionStorage = memoryStorage();
  globalThis.window = { localStorage, sessionStorage, crypto: webcrypto };
  return { localStorage, sessionStorage };
}

test("damaged, non-object and invalid shopping bags recover safely", () => {
  for (const raw of ["bad json", "null", "[]", '"text"', "2"]) assert.deepEqual(parseShoppingBag(raw), { bag: {}, recovered: true });
  const restored = parseShoppingBag('{"test-item":15,"negative":-2,"fraction":1.5,"text":"2","__proto__":1}');
  assert.deepEqual(restored.bag, { "test-item": 10 });
  assert.equal(restored.recovered, true);
  assert.deepEqual(parseShoppingBag(null), { bag: {}, recovered: false });
});

test("availability, removal and the per-product cap are consistent", () => {
  assert.equal(productQuantityLimit(product), 2);
  assert.equal(productQuantityLimit({ ...product, inventory: 200 }), 10);
  assert.equal(productQuantityLimit({ ...product, inventory: 0 }), 0);
  assert.equal(shoppingBagNeedsReview({ "test-item": 3 }, [product]), true);
  assert.equal(shoppingBagNeedsReview({ removed: 1 }, [product]), true);
  assert.equal(shoppingBagNeedsReview({ "test-item": 2 }, [product]), false);
  assert.deepEqual(reconcileShoppingBag({ "test-item": 8, removed: 1 }, [product]), { "test-item": 2 });
});

test("all inherited object keys are rejected as shopping-bag and product IDs", () => {
  for (const id of Object.getOwnPropertyNames(Object.prototype)) {
    assert.deepEqual(parseShoppingBag(JSON.stringify({ [id]: 1 })), { bag: {}, recovered: true });
    assert.throws(() => parseCatalogResponse({ ok: true, products: [{ ...product, id }] }));
  }
});

test("empty live catalogue stays empty; invalid stock and duplicate IDs fail closed", () => {
  assert.deepEqual(parseCatalogResponse({ ok: true, products: [] }), []);
  assert.equal(parseCatalogResponse({ ok: true, products: [{ ...product, price: 1 }] })[0].price, 129);
  for (const products of [[{ ...product, inventory: -1 }], [{ ...product, inventory: 1.5 }], [{ ...product, priceCents: NaN }], [product, product]]) {
    assert.throws(() => parseCatalogResponse({ ok: true, products }));
  }
  assert.throws(() => parseCatalogResponse({ ok: false, products: [product] }));
});

test("supplier HTTPS images and local images work without permitting unsafe schemes", () => {
  for (const image of ["/products/nova.webp", "https://images.example.com/product.webp"]) {
    assert.equal(isSafeProductImage(image), true);
    assert.equal(parseCatalogResponse({ ok: true, products: [{ ...product, image }] })[0].image, image);
  }
  for (const image of ["//example.com/image.webp", "/\\example.com/image.webp", "/products/../private.png", "/products/%2e%2e/private.png", "/products/%252e%252e/private.png", "javascript:alert(1)", "http://example.com/image.webp", "https://example.com/\nimage.webp", "https://username:password@example.com/image.webp"]) {
    assert.equal(isSafeProductImage(image), false);
    assert.throws(() => parseCatalogResponse({ ok: true, products: [{ ...product, image }] }));
  }
});

test("blocked storage falls back to the session without throwing", () => {
  const { sessionStorage } = browser();
  window.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(writeBrowserValue("bag", "{}"), true);
  assert.equal(readBrowserValue("bag"), "{}");
  assert.equal(sessionStorage.getItem("bag"), "{}");
  window.sessionStorage = window.localStorage;
  assert.equal(writeBrowserValue("bag", "{}"), false);
  assert.equal(readBrowserValue("bag"), null);
});

test("checkout retries reuse a key only for identical inputs and never persist contact data", async () => {
  const { localStorage } = browser();
  clearCheckoutRetry();
  const input = { email: "example@example.com", address: "Example address", items: [{ id: "test-item", quantity: 1 }] };
  const first = await retryKeyFor(input);
  assert.equal(wasCheckoutAttempted(first), false);
  markCheckoutAttempted(first);
  assert.equal(wasCheckoutAttempted(first), true);
  assert.equal(await retryKeyFor(input), first);
  assert.match(first, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  const saved = localStorage.getItem(CHECKOUT_RETRY_STORAGE_KEY);
  assert.equal(saved.includes(input.email), false);
  assert.equal(saved.includes(input.address), false);
  const different = await retryKeyFor({ ...input, address: "Changed address" });
  assert.notEqual(different, first);
  assert.equal(wasCheckoutAttempted(different), false);
  const changed = await retryKeyFor(input);
  clearCheckoutRetry();
  assert.notEqual(await retryKeyFor(input), changed, "a new request after success must not reuse a completed order key");
});

test("network catalogue failure does not return presentation fixtures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(fetchLiveCatalog(), /catalog_unavailable/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, products: [] }) });
    assert.deepEqual(await fetchLiveCatalog(), []);
  } finally { globalThis.fetch = originalFetch; }
});

test("catalogue reads every page before validating a bag item beyond the first 500 products", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url) => {
      requests.push(url);
      const last = String(url).includes("cursor=page-two");
      return { ok: true, json: async () => ({ ok: true,
        products: last ? [{ ...product, id: "item-501" }] : Array.from({ length: 500 }, (_, index) => ({ ...product, id: `item-${index + 1}` })),
        pageInfo: last ? { hasMore: false, nextCursor: null } : { hasMore: true, nextCursor: "page-two" },
      }) };
    };
    const catalog = await fetchLiveCatalog(undefined, { q: "Example", locale: "en", sort: "price-low" });
    assert.equal(catalog.length, 501);
    assert.deepEqual(reconcileShoppingBag({ "item-501": 1 }, catalog), { "item-501": 1 });
    assert.equal(requests.length, 2);
    assert.match(requests[1], /cursor=page-two/);
    assert.match(requests[1], /q=Example/);
    assert.match(requests[1], /sort=price-low/);
  } finally { globalThis.fetch = originalFetch; }
});

test("a later catalogue request failure rejects the entire catalogue instead of returning the first page", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async () => ++requests === 1
      ? { ok: true, json: async () => ({ ok: true, products: [product], pageInfo: { hasMore: true, nextCursor: "next" } }) }
      : { ok: false };
    await assert.rejects(fetchLiveCatalog(), /catalog_unavailable/);
    assert.equal(requests, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("malformed pagination, repeated cursors and cross-page duplicate products fail closed", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const info of [null, [], {}, { hasMore: "true", nextCursor: "next" }, { hasMore: true, nextCursor: "" }, { hasMore: false, nextCursor: "next" }]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, products: [product], pageInfo: info }) });
      await assert.rejects(fetchLiveCatalog(), /catalog_invalid/);
    }
    for (const failure of ["cursor", "duplicate", "missing"]) {
      let page = 0;
      globalThis.fetch = async () => ({ ok: true, json: async () => ++page === 1
        ? { ok: true, products: [product], pageInfo: { hasMore: true, nextCursor: "same" } }
        : { ok: true, products: [{ ...product, id: failure === "duplicate" ? product.id : "another" }],
          ...(failure === "missing" ? {} : { pageInfo: { hasMore: true, nextCursor: "same" } }),
        } });
      await assert.rejects(fetchLiveCatalog(), /catalog_invalid/);
    }
  } finally { globalThis.fetch = originalFetch; }
});
