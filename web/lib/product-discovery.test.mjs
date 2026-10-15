import assert from "node:assert/strict";
import { test } from "node:test";
import {
  discoverProducts, hasProductDiscount, productDiscountPercent, productPriceCents,
} from "./product-discovery.ts";

const product = {
  id: "speaker", sku: "AUDIO-12", name: "Portable speaker", price: 29.99, priceCents: 2999,
  compareAt: null, rating: 0, reviews: 0, category: "tech", image: "/products/nova.webp",
  color: "ice", inventory: 2, fulfillmentMode: "supplier",
  badge: { en: "Compact", zh: "小巧", es: "Pequeño" },
  description: { en: "Wireless audio", zh: "无线音箱", es: "Altavoz inalámbrico" },
  detail: { en: "USB charging with twelve hours of play", zh: "USB 充电，可播放十二小时", es: "Carga USB para doce horas de música" },
};
const filters = {
  locale: "en", category: "all", query: "", sort: "default", collection: "all", priceBand: "any",
  inStockOnly: false, favorites: {},
};
const search = (products, overrides = {}) => discoverProducts(products, { ...filters, ...overrides });
const ids = (products) => products.map((item) => item.id);
const priced = (id, priceCents, extra = {}) => ({ ...product, id, price: priceCents / 100, priceCents, ...extra });

test("empty catalogues and empty searches never fabricate products", () => {
  assert.deepEqual(search([]), []);
  assert.deepEqual(search([], { query: "speaker", collection: "deals" }), []);
  assert.deepEqual(search([product], { query: "  \n\t " }), [product]);
  assert.deepEqual(search([product], { query: "missing" }), []);
});

test("search covers names, SKU and description/detail/badge in all three languages", () => {
  for (const query of ["portable", "audio-12", "WIRELESS", "charging", "compact", "无线", "十二小时", "小巧", "inalámbrico", "música", "pequeño"]) {
    for (const locale of ["en", "zh", "es"]) assert.deepEqual(search([product], { query, locale }), [product]);
  }
});

test("search normalizes Unicode width, composed accents, whitespace and matches every token", () => {
  assert.deepEqual(search([product], { query: "  ＡＵＤＩＯ－１２ \n\t ＵＳＢ " }), [product]);
  assert.deepEqual(search([product], { query: "MU\u0301SICA" }), [product]);
  assert.deepEqual(search([product], { query: "portable 无线 USB" }), [product]);
  assert.deepEqual(search([product], { query: "portable unavailable" }), []);
  assert.deepEqual(search([product], { query: "<script>" }), []);
});

test("only supported category aliases are searchable across Chinese, English and Spanish", () => {
  const source = [
    { ...product, id: "home", sku: "HOME-01", category: "home" },
    { ...product, id: "tech", sku: "TECH-02", category: "tech" },
    { ...product, id: "wear", sku: "BAG-03", category: "wear" },
  ];
  for (const [id, aliases] of [
    ["home", ["家居", "家居生活", "hogar", "home", "living"]],
    ["tech", ["数码", "数码电子", "科技", "electronics", "tech", "tecnología", "electronica", "electrónica"]],
    ["wear", ["箱包", "配饰", "箱包配饰", "bags", "accessories", "bolsos", "accesorios"]],
  ]) {
    const sku = source.find((item) => item.id === id).sku;
    for (const alias of aliases) {
      assert.deepEqual(ids(search(source, { query: alias })), [id]);
      for (const locale of ["en", "zh", "es"]) {
        assert.deepEqual(ids(search(source, { query: `${alias} ${sku}`, locale })), [id]);
      }
    }
  }
  assert.deepEqual(ids(search(source, { query: "电子" })), ["tech"]);
  assert.deepEqual(search(source, { query: "数码 BAG-03" }), []);
  for (const query of ["beauty", "美妆", "furniture", "食品", "mascotas", "jewelry"]) {
    assert.deepEqual(search(source, { query }), []);
  }
});

test("category, stock, collection and search filters combine without changing source objects", () => {
  const source = Object.freeze([
    Object.freeze(priced("tech-deal", 2000, { compareAtCents: 2500 })),
    Object.freeze(priced("tech-empty", 2000, { inventory: 0, compareAtCents: 2500 })),
    Object.freeze(priced("home-deal", 2000, { category: "home", compareAtCents: 2500 })),
    Object.freeze(priced("tech-full", 2000)),
  ]);
  const result = search(source, { category: "tech", query: "speaker", collection: "deals", inStockOnly: true });
  assert.deepEqual(ids(result), ["tech-deal"]);
  assert.equal(result[0], source[0]);
  assert.deepEqual(ids(source), ["tech-deal", "tech-empty", "home-deal", "tech-full"]);
  assert.notEqual(result, source);
  for (const inventory of [0, -1, NaN, Infinity]) {
    assert.deepEqual(search([{ ...product, inventory }], { inStockOnly: true }), []);
  }
});

test("saved items require an own true property and never inherit prototype favorites", () => {
  const source = [priced("saved", 100), priced("unsaved", 100), priced("inherited", 100), priced("constructor", 100)];
  const favorites = Object.create({ inherited: true });
  favorites.saved = true;
  favorites.unsaved = false;
  assert.deepEqual(ids(search(source, { collection: "saved", favorites })), ["saved"]);
  assert.deepEqual(search([product], { collection: "saved", favorites: { speaker: "true" } }), []);
  assert.deepEqual(search([product], { collection: "saved", favorites: Object.create(null) }), []);
});

test("price bands use cents and have non-overlapping exact boundaries", () => {
  const source = [0, 2499, 2500, 4999, 5000, 9999, 10000, 10001].map((cents) => priced(String(cents), cents));
  assert.deepEqual(ids(search(source, { priceBand: "under-25" })), ["0", "2499"]);
  assert.deepEqual(ids(search(source, { priceBand: "25-50" })), ["2500", "4999"]);
  assert.deepEqual(ids(search(source, { priceBand: "50-100" })), ["5000", "9999"]);
  assert.deepEqual(ids(search(source, { priceBand: "100-plus" })), ["10000", "10001"]);
  assert.deepEqual(search(source), source);
  assert.deepEqual(search([{ ...product, priceCents: NaN }], { priceBand: "under-25" }), []);
});

test("authoritative cents include zero and legacy dollar prices are rounded to cents", () => {
  assert.equal(productPriceCents({ ...product, priceCents: 0, price: 999 }), 0);
  assert.equal(productPriceCents({ ...product, priceCents: undefined, price: 19.995 }), 2000);
  assert.equal(productPriceCents({ ...product, priceCents: undefined, price: 0 }), 0);
  for (const priceCents of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(Number.isNaN(productPriceCents({ ...product, priceCents })), true);
  }
});

test("deals require a higher valid comparison price rather than a sale badge", () => {
  for (const compareAtCents of [null, 0, 2999, 2000, -1, 1.5, NaN, Infinity]) {
    const item = { ...product, compareAtCents, compareAt: 99, badge: { en: "Sale", zh: "优惠", es: "Oferta" } };
    assert.equal(hasProductDiscount(item), false);
    assert.equal(productDiscountPercent(item), null);
    assert.deepEqual(search([item], { collection: "deals" }), []);
  }
  const item = { ...product, compareAtCents: 3999, compareAt: null };
  assert.equal(hasProductDiscount(item), true);
  assert.equal(productDiscountPercent(item), 25);
  assert.deepEqual(search([item], { collection: "deals" }), [item]);
  assert.equal(hasProductDiscount({ ...product, compareAtCents: undefined, compareAt: 39.99 }), true);
  assert.equal(hasProductDiscount({ ...product, priceCents: NaN, compareAtCents: 3999 }), false);
});

test("discount percentages never overstate savings or display zero percent savings", () => {
  assert.equal(productDiscountPercent(priced("zero", 0, { compareAtCents: 1000 })), 100);
  assert.equal(productDiscountPercent(priced("fraction", 7001, { compareAtCents: 10000 })), 29);
  const tinyDiscount = priced("tiny", 9999, { compareAtCents: 10000 });
  assert.equal(hasProductDiscount(tinyDiscount), true);
  assert.equal(productDiscountPercent(tinyDiscount), null);
});

test("default order is the real catalogue order and price sorting is stable without mutation", () => {
  const source = Object.freeze([priced("middle-first", 2500), priced("high", 9999), priced("zero", 0), priced("middle-second", 2500)]);
  assert.deepEqual(ids(search(source)), ["middle-first", "high", "zero", "middle-second"]);
  assert.deepEqual(ids(search(source, { sort: "price-low" })), ["zero", "middle-first", "middle-second", "high"]);
  assert.deepEqual(ids(search(source, { sort: "price-high" })), ["high", "middle-first", "middle-second", "zero"]);
  assert.deepEqual(ids(source), ["middle-first", "high", "zero", "middle-second"]);
  assert.deepEqual(search(source, { sort: "price-low" })[1], source[0]);
});

test("group prices and deal filters use buyable variants when stock differs", () => {
  const soldOut = priced("cheap-sold-out", 1000, { inventory: 0, compareAtCents: 2000 });
  const available = priced("available", 10000, { inventory: 3, compareAtCents: null });
  const group = { ...product, id: "group", variants: [soldOut, available], inventory: 0 };
  assert.equal(productPriceCents(group), 10000);
  assert.deepEqual(search([group], { inStockOnly: true, priceBand: "under-25" }), []);
  assert.deepEqual(search([group], { inStockOnly: true, priceBand: "100-plus" }), [group]);
  assert.deepEqual(search([group], { inStockOnly: true, collection: "deals" }), []);
  assert.equal(productPriceCents({ ...group, variants: [{ ...soldOut }, { ...available, inventory: 0 }] }), 1000);
});
