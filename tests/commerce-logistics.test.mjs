import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { env } from "./commerce-test-env.mjs";

register("./commerce-module-loader.mjs", import.meta.url);
const { retrieveShipmentQuote } = await import("../backend/api/logistics/shippo.ts");

test("custom carrier mapping survives a provider quote", async () => {
  const originalFetch = globalThis.fetch;
  env.SHIPPO_API_TOKEN = `shippo_test_${"a".repeat(20)}`;
  env.LOGISTICS_CARRIER_MAP = JSON.stringify({ ontrac: "ontrac" });
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, "https://api.goshippo.com/shipments/ship_123/");
      return new Response(JSON.stringify({
        object_id: "ship_123", status: "SUCCESS",
        rates: [{ object_id: "rate_123", provider: "OnTrac", amount: "12.34", currency: "USD",
          servicelevel_name: "Ground", estimated_days: 3 }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const quote = await retrieveShipmentQuote("ship_123");
    assert.equal(quote.rates.length, 1);
    assert.equal(quote.rates[0].trackingCarrier, "ontrac");
    assert.equal(quote.rates[0].amountCents, 1234);
  } finally {
    globalThis.fetch = originalFetch;
    delete env.SHIPPO_API_TOKEN;
    delete env.LOGISTICS_CARRIER_MAP;
  }
});
