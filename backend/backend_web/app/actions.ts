"use server";

import { revalidatePath } from "next/cache";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { getChatGPTUser } from "@backend/auth";
import { addProductStock, setOrderStatus } from "@backend/db/ops";
import { createCatalogProduct, importCatalogProducts, updateCatalogProduct } from "@backend/db/catalog";
import { fulfillmentModes, orderStatuses } from "@shared/ops-types";
import { isProductImage } from "@shared/assets";
import { isStorefrontProductId } from "@shared/product-id";

import type { OpsActionState } from "./action-state";
export type { OpsActionState } from "./action-state";

const orderStatusSchema = z.object({
  orderNumber: z.string().regex(/^(?:MW|HW)-\d{5,8}$/),
  status: z.enum(orderStatuses),
  expectedVersion: z.coerce.number().int().min(0).optional(),
});

const stockSchema = z.object({
  sku: z.string().min(3).max(32),
  quantity: z.coerce.number().int().min(1).max(1000),
  note: z.string().trim().max(200),
});

const amountSchema = z.string().trim().regex(/^\d{1,6}(?:\.\d{1,2})?$/)
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  }).refine((value) => value > 0 && value <= 100000000);
const localizedSchema = z.object({ en: z.string().trim().max(5000), zh: z.string().trim().max(5000), es: z.string().trim().max(5000) })
  .transform((value) => ({ en: value.en, zh: value.zh || value.en, es: value.es || value.en }));
const productSchema = z.object({
  sku: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/),
  storefrontId: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).refine(isStorefrontProductId),
  name: z.string().trim().min(1).max(160),
  priceCents: amountSchema,
  compareAtCents: z.union([z.literal("").transform(() => null), amountSchema]),
  category: z.enum(["home", "tech", "wear"]),
  image: z.string().trim().max(2048).refine(isProductImage),
  status: z.enum(["active", "paused"]),
  defaultFulfillment: z.enum(fulfillmentModes),
  expectedVersion: z.coerce.number().int().min(0).optional(),
  metadata: z.object({ color: z.enum(["blue", "ice", "coral"]), badge: localizedSchema, description: localizedSchema, detail: localizedSchema }),
}).refine((value) => value.compareAtCents === null || value.compareAtCents > value.priceCents);

export async function updateOrderStatusAction(
  _previousState: OpsActionState,
  formData: FormData
): Promise<OpsActionState> {
  const user = await getChatGPTUser();
  if (!user) return actionError("Sign in before changing an order.");
  if (!isStoreOwner(user.userId)) return actionError("This account cannot manage the store.");

  const parsed = orderStatusSchema.safeParse({
    orderNumber: formData.get("orderNumber"),
    status: formData.get("status"),
    expectedVersion: formData.has("expectedVersion") ? formData.get("expectedVersion") : undefined,
  });
  if (!parsed.success) return actionError("Choose a valid order status.");

  try {
    const result = await setOrderStatus(
      user.userId,
      parsed.data.orderNumber,
      parsed.data.status,
      parsed.data.expectedVersion
    );
    if (result === "not_found") return actionError("That order could not be found.");
    if (result === "unpaid") return actionError("Payment must be completed before fulfillment can start.");
    if (result === "invalid_transition") return actionError("Complete the current step before advancing to the next one.");
    if (result === "conflict") return actionError("This order changed elsewhere. Refresh before trying again.");

    revalidatePath("/ops");
    revalidatePath("/");
    return {
      kind: "success",
      message: `${parsed.data.orderNumber} moved to ${parsed.data.status}.`,
      eventId: Date.now(),
    };
  } catch (error) {
    console.error("Failed to update order status", error);
    return actionError("The update did not save. Try again.");
  }
}

export async function addStockAction(
  _previousState: OpsActionState,
  formData: FormData
): Promise<OpsActionState> {
  const user = await getChatGPTUser();
  if (!user) return actionError("Sign in before changing inventory.");
  if (!isStoreOwner(user.userId)) return actionError("This account cannot manage the store.");

  const parsed = stockSchema.safeParse({
    sku: formData.get("sku"),
    quantity: formData.get("quantity"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return actionError("Choose a valid restock amount.");

  try {
    const changed = await addProductStock(
      user.userId,
      parsed.data.sku,
      parsed.data.quantity,
      parsed.data.note
    );
    if (!changed) return actionError("That product could not be found.");

    revalidatePath("/ops");
    revalidatePath("/");
    return {
      kind: "success",
      message: `${parsed.data.quantity} units added to ${parsed.data.sku}.`,
      eventId: Date.now(),
    };
  } catch (error) {
    console.error("Failed to update inventory", error);
    return actionError("The inventory change did not save. Try again.");
  }
}

export async function importProductsAction(_previousState: OpsActionState): Promise<OpsActionState> {
  const user = await getChatGPTUser();
  if (!user || !isStoreOwner(user.userId)) return actionError("Only the store owner can import products.");
  try {
    const result = await importCatalogProducts(user.userId);
    revalidatePath("/");
    revalidatePath("/ops");
    return { kind: "success", message: `${result.imported} templates imported with zero stock and paused sales. ${result.skipped} existing SKUs preserved.`, eventId: Date.now() };
  } catch {
    return actionError("Product templates could not be imported. Existing products are unchanged.");
  }
}

export async function saveProductAction(_previousState: OpsActionState, formData: FormData): Promise<OpsActionState> {
  const user = await getChatGPTUser();
  if (!user || !isStoreOwner(user.userId)) return actionError("Only the store owner can manage products.");
  const parsed = productSchema.safeParse({
    sku: formData.get("sku"), storefrontId: formData.get("storefrontId"), name: formData.get("name"),
    priceCents: formData.get("price"), compareAtCents: formData.get("compareAt") ?? "",
    category: formData.get("category"), image: formData.get("image"),
    status: formData.get("status"), defaultFulfillment: formData.get("defaultFulfillment"),
    expectedVersion: formData.has("expectedVersion") ? formData.get("expectedVersion") : undefined,
    metadata: {
      color: formData.get("color") ?? "blue",
      badge: Object.fromEntries(["en", "zh", "es"].map((locale) => [locale, formData.get(`badge_${locale}`) ?? ""])),
      description: Object.fromEntries(["en", "zh", "es"].map((locale) => [locale, formData.get(`description_${locale}`) ?? ""])),
      detail: Object.fromEntries(["en", "zh", "es"].map((locale) => [locale, formData.get(`detail_${locale}`) ?? ""])),
    },
  });
  if (!parsed.success) return actionError("Check product fields: USD price above zero, compare-at above price, a unique lowercase URL ID, and an HTTPS or /products/ image.");
  const { sku, ...input } = parsed.data;
  try {
    if (formData.get("mode") === "create") {
      const result = await createCatalogProduct(user.userId, { sku, ...input });
      if (result === "exists") return actionError("That SKU or product URL already exists. No existing product was overwritten.");
    } else {
      const changed = await updateCatalogProduct(user.userId, sku, input);
      if (!changed) return actionError("Product not found or changed elsewhere. Refresh before editing again.");
    }
    revalidatePath("/");
    revalidatePath("/ops");
    return { kind: "success", message: `${sku} saved. New products start paused with zero stock.`, eventId: Date.now() };
  } catch {
    return actionError("Product could not be saved. Check for duplicate SKU / product URL and try again.");
  }
}

function actionError(message: string): OpsActionState {
  return { kind: "error", message, eventId: Date.now() };
}

function isStoreOwner(userId: string) {
  const ownerId = (env as unknown as Record<string, string | undefined>).STORE_OWNER_ID?.trim();
  return Boolean(ownerId && ownerId === userId);
}
