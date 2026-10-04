import { destinations, products } from "@shared/catalog";
import { paymentAvailability } from "@backend/payments";
import { json } from "./json";
export function GET() {
  return json({ ok: true, apiVersion: "v1", currency: "USD", locales: ["en", "zh", "es"],
    destinations, payments: paymentAvailability,
    products: products.map((product) => ({ ...product,
      priceCents: Math.round(product.price * 100),
      compareAtCents: product.compareAt === null ? null : Math.round(product.compareAt * 100),
    })),
  });
}
