import { z } from "zod";
import { isProductImage } from "./assets.ts";
import { isStorefrontProductId } from "./product-id.ts";

/** Human-readable dimensions, not encoded client-controlled prices or inventory. */
export const variantAttributesSchema = z.record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(60))
  .superRefine((attributes, context) => {
    const keys = Object.keys(attributes);
    if (keys.length > 3 || keys.some((key) => ["__proto__", "constructor", "prototype"].includes(key))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Use up to three safe, named dimensions." });
    }
    if (new Set(keys.map((key) => key.toLowerCase())).size !== keys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Dimension names must be distinct." });
    }
  });
export type VariantAttributes = z.infer<typeof variantAttributesSchema>;
const variantImagesSchema = z.array(z.string().trim().max(2048).refine(isProductImage)).max(8);
export const variantEditSchema = z.object({
  attributes: variantAttributesSchema,
  priceCents: z.number().int().min(1).max(100_000_000),
  compareAtCents: z.number().int().min(1).max(100_000_000).nullable().optional(),
  image: z.string().trim().max(2048).refine(isProductImage).nullable().optional(),
  images: variantImagesSchema.optional(),
  shippingWeightGrams: z.number().int().min(1).max(1_000_000),
  defaultFulfillment: z.enum(["marketplace", "self", "supplier"]),
  status: z.enum(["active", "paused"]),
});
export const variantCreateSchema = variantEditSchema.omit({ status: true }).extend({
  sku: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.-]+$/),
  storefrontId: z.string().trim().refine(isStorefrontProductId),
});
export type ProductVariantCreate = z.infer<typeof variantCreateSchema>;
export type ProductVariantEdit = z.infer<typeof variantEditSchema>;

export function variantSignature(attributes: VariantAttributes): string | null {
  const keys = Object.keys(attributes).sort();
  return keys.length ? JSON.stringify(keys.map((key) => [key, attributes[key]])) : null;
}
export function variantLabel(attributes?: VariantAttributes): string {
  return attributes ? Object.entries(attributes).map(([name, value]) => `${name}: ${value}`).join(" / ") : "";
}
export function readVariantAttributes(json: string | null): VariantAttributes {
  try { return variantAttributesSchema.parse(JSON.parse(json ?? "{}")); } catch { return {}; }
}

export function readVariantImages(json: string | null): string[] | null {
  try {
    const metadata: unknown = JSON.parse(json ?? "null");
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !Object.hasOwn(metadata, "images")) return null;
    const parsed = variantImagesSchema.safeParse((metadata as Record<string, unknown>).images);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
