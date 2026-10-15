import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { createDatabase, insertProduct } from "./commerce-db-fixture.mjs";
import { createD1Adapter } from "./commerce-d1-fixture.mjs";
import { env } from "./commerce-test-env.mjs";

register("./commerce-module-loader.mjs", import.meta.url);
const catalog = await import("../backend/api/db/catalog.ts");
const variants = await import("../backend/api/db/variants.ts");
const { variantSignature } = await import("../shared/variants.ts");

test("variant galleries survive save and appear in admin and storefront reads", async () => {
  const database = createDatabase();
  const owner = "variant-gallery-owner";
  env.DB = createD1Adapter(database);
  env.STORE_OWNER_ID = owner;
  try {
    const localized = { en: "Product details", zh: "商品介绍", es: "Detalles del producto" };
    insertProduct(database, {
      id: "variant-root", owner_id: owner, sku: "ROOT-01", name: "Colorful item",
      storefront_id: "colorful-item", price_cents: 2000, category: "home",
      image: "/products/kumo.webp", status: "active", stock: 0,
      metadata_json: JSON.stringify({ color: "blue", badge: localized, description: localized, detail: localized,
        images: ["/products/kumo.webp"] }),
      variant_attributes_json: JSON.stringify({ Color: "Blue" }),
      variant_signature: variantSignature({ Color: "Blue" }),
    });
    assert.equal(await variants.createProductVariant(owner, "ROOT-01", 0, {
      sku: "ROOT-RED", storefrontId: "colorful-red", attributes: { Color: "Red" },
      priceCents: 2500, compareAtCents: null, image: "/products/nova.webp",
      images: ["/products/nova.webp", "/products/kumo.webp"],
      shippingWeightGrams: 500, defaultFulfillment: "self",
    }), "created");

    const first = (await variants.getProductVariants(owner, "ROOT-01")).find((item) => item.sku === "ROOT-RED");
    assert.deepEqual(first.images, ["/products/nova.webp", "/products/kumo.webp"]);
    assert.equal(await variants.updateProductVariant(owner, "ROOT-RED", first.version, {
      attributes: { Color: "Red" }, priceCents: 2500, compareAtCents: null,
      image: "/products/nova.webp", images: ["/products/kumo.webp", "/products/nova.webp"],
      shippingWeightGrams: 500, defaultFulfillment: "self", status: "active",
    }), "updated");

    const reloaded = (await variants.getProductVariants(owner, "ROOT-01")).find((item) => item.sku === "ROOT-RED");
    assert.deepEqual(reloaded.images, ["/products/kumo.webp", "/products/nova.webp"]);
    const detail = await catalog.getStorefrontProductDetail(owner, "colorful-item");
    const child = detail.variants.find((item) => item.sku === "ROOT-RED");
    assert.deepEqual(child.images, ["/products/nova.webp", "/products/kumo.webp"]);
    assert.deepEqual((await catalog.getStorefrontProduct(owner, "colorful-red")).images, child.images);
  } finally {
    delete env.DB;
    delete env.STORE_OWNER_ID;
    database.close();
  }
});
