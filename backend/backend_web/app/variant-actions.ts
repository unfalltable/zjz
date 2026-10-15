"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStoreOperator } from "@backend/http/admin-access";
import { createProductVariant, updateProductVariant } from "@backend/db/variants";
import { variantCreateSchema, variantEditSchema } from "@shared/variants";
import { isManagedProductImage, isManagedProductImageForOwner } from "@shared/assets";
import type { OpsActionState } from "./action-state";

const amount = z.string().regex(/^\d{1,6}(\.\d{1,2})?$/).transform(value => { const [whole, fraction = ""] = value.split("."); return Number(whole) * 100 + Number(fraction.padEnd(2, "0")); });
const version = z.string().regex(/^\d{1,10}$/).transform(Number);
function attributes(data: FormData) {
  const entries: [string, string][] = [];
  for (let i = 1; i <= 3; i++) {
    const key = String(data.get(`attributeName${i}`) ?? "").trim();
    const value = String(data.get(`attributeValue${i}`) ?? "").trim();
    if ((key && !value) || (!key && value)) return null;
    if (key) entries.push([key, value]);
  }
  if (!entries.length || new Set(entries.map(([key]) => key.toLowerCase())).size !== entries.length) return null;
  return Object.fromEntries(entries);
}
function state(kind: "success" | "error", message: string): OpsActionState { return { kind, message, eventId: Date.now() }; }
async function ownsUploadedImages(images: string[] | undefined, owner: string): Promise<boolean> {
  for (const url of images ?? []) {
    if (isManagedProductImage(url) && !await isManagedProductImageForOwner(url, owner)) return false;
  }
  return true;
}

export async function saveVariantAction(_previous: OpsActionState, data: FormData): Promise<OpsActionState> {
  try {
    const owner = await requireStoreOperator();
    const parsedPrice = amount.safeParse(data.get("price"));
    const compare = String(data.get("compareAt") ?? "");
    const compareResult = compare ? amount.safeParse(compare) : null;
    const expectedVersion = version.safeParse(data.get("expectedVersion"));
    const target = z.string().trim().min(1).max(64).safeParse(data.get("targetSku"));
    if (!parsedPrice.success || (compareResult && !compareResult.success) || !expectedVersion.success || !target.success) return state("error", "检查 SKU、售价和版本后重试。Check SKU, price and version.");
    const image = String(data.get("image") ?? "").trim();
    let images: unknown;
    if (data.has("images")) {
      try { images = JSON.parse(String(data.get("images"))); }
      catch { return state("error", "图片列表无效。Invalid image gallery."); }
    }
    const values = { attributes: attributes(data), priceCents: parsedPrice.data, compareAtCents: compareResult?.success ? compareResult.data : null,
      image: image || null, images, shippingWeightGrams: Number(data.get("shippingWeightGrams")), defaultFulfillment: data.get("defaultFulfillment"), status: data.get("status") };
    if (image && isManagedProductImage(image) && !await isManagedProductImageForOwner(image, owner)) return state("error", "图片不属于本店。The uploaded image belongs to another store.");
    let result;
    if (data.get("mode") === "create") {
      const parsed = variantCreateSchema.safeParse({ ...values, sku: data.get("sku"), storefrontId: data.get("storefrontId") });
      if (!parsed.success) return state("error", "请检查规格名称、规格值、价格、图片和重量。Check the variant fields.");
      if (!await ownsUploadedImages(parsed.data.images, owner)) return state("error", "图片不属于本店。The uploaded image belongs to another store.");
      result = await createProductVariant(owner, target.data, expectedVersion.data, parsed.data);
    } else if (data.get("mode") === "edit") {
      const parsed = variantEditSchema.safeParse(values);
      if (!parsed.success) return state("error", "请检查规格名称、规格值、价格、图片和重量。Check the variant fields.");
      if (!await ownsUploadedImages(parsed.data.images, owner)) return state("error", "图片不属于本店。The uploaded image belongs to another store.");
      result = await updateProductVariant(owner, target.data, expectedVersion.data, parsed.data);
    } else return state("error", "无效操作。Invalid operation.");
    if (result !== "created" && result !== "updated") return state("error", result === "exists" ? "SKU、商品地址或规格组合重复，未覆盖现有商品。Duplicate SKU, URL or combination; existing products are unchanged." : "数据已变化或商品不存在，请刷新后重试。Product changed or is unavailable; refresh first.");
    revalidatePath("/ops"); revalidatePath("/");
    return state("success", result === "created" ? "规格已创建，初始下架且库存为 0。Variant created, paused with zero stock." : "规格已保存，历史订单不变。Variant saved; historical orders are unchanged.");
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (/variant_dimension/.test(code)) return state("error", "先为主 SKU 设置规格。所有 SKU 必须使用相同的规格名称；已有子规格时不能改维度名称。Define dimensions on the main SKU first; all variants must use the same names.");
    return state("error", "未保存，请确认后台权限并刷新重试。Not saved; check admin access and refresh.");
  }
}
