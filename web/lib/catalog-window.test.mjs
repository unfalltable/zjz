import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogWindowLimit, expandCatalogWindow } from "./catalog-window.ts";

test("a catalogue begins with 24 cards without changing the complete source", () => {
  const products = Array.from({ length: 501 }, (_, id) => ({ id }));
  const window = { scope: "", limit: 24 };
  assert.equal(products.slice(0, catalogWindowLimit(window, "all")).length, 24);
  assert.equal(products.length, 501);
});

test("show more preserves order and caps the final group at the actual match count", () => {
  let window = { scope: "all", limit: 24 };
  window = expandCatalogWindow(window, "all", 501);
  assert.equal(window.limit, 48);
  for (let page = 0; page < 20; page++) window = expandCatalogWindow(window, "all", 501);
  assert.equal(window.limit, 501);
  assert.deepEqual(expandCatalogWindow(window, "all", 501), window);
});

test("language, category, search or sort changes start at the first display group", () => {
  const scope = JSON.stringify(["en", "all", "", "featured"]);
  const window = { scope, limit: 96 };
  for (const next of [["zh", "all", "", "featured"], ["en", "home", "", "featured"],
    ["en", "all", "speaker", "featured"], ["en", "all", "", "price-low"]]) {
    const nextScope = JSON.stringify(next);
    assert.equal(catalogWindowLimit(window, nextScope), 24);
    assert.equal(expandCatalogWindow(window, nextScope, 60).limit, 48);
  }
});

test("empty, small and invalid counts do not fabricate catalogue rows", () => {
  const window = { scope: "all", limit: 24 };
  assert.equal(expandCatalogWindow(window, "all", 0).limit, 0);
  assert.equal(expandCatalogWindow(window, "all", 8).limit, 8);
  for (const total of [-1, NaN, Infinity, 1.2]) assert.throws(() => expandCatalogWindow(window, "all", total));
});
