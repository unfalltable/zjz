"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStoreOperator } from "@backend/http/admin-access";
import { reviewOrder, createShipment, updateShipment, createAfterSale, updateAfterSale } from "@backend/db/admin-commerce";
import { saveShippingRule, saveCarrier } from "@backend/db/shipping";
import { fulfillmentModes } from "@shared/ops-types";
import { shippingMethods, shippingCountries } from "@shared/shipping";
import type { OperationResult } from "@shared/admin-commerce";
import type { OpsActionState } from "./action-state";

const orderNumber = z.string().regex(/^(?:MW|HW)-\d{5,8}$/);
const version = z.string().regex(/^\d{1,10}$/).transform(Number);
const configVersion = z.string().regex(/^(?:-1|\d{1,10})$/).transform(Number);
const id = z.string().trim().min(1).max(100);
const note = z.string().trim().min(1).max(1000);
const lines = z.array(z.object({ sku: z.string().trim().min(1).max(64), quantity: z.number().int().min(1).max(1000) })).min(1).max(20);
const whole = z.string().regex(/^\d{1,10}$/).transform(Number);
// Amount fields use integer cents; there is no floating-point currency conversion.
const cents = whole.refine((value) => Number.isSafeInteger(value) && value <= 100000000);
const checkbox = (data: FormData, name: string) => ["on", "true", "1"].includes(String(data.get(name)));

function parsedLines(data: FormData) {
  try { return JSON.parse(String(data.get("items") ?? "null")); } catch { return null; }
}
function state(kind: "success" | "error", message: string): OpsActionState { return { kind, message, eventId: Date.now() }; }
async function execute<S extends z.ZodTypeAny>(schema: S, input: unknown, work: (owner: string, value: z.output<S>) => Promise<OperationResult>, success: string): Promise<OpsActionState> {
  try {
    // Authentication and surface isolation are checked on every invocation, not just page load.
    const owner = await requireStoreOperator();
    const parsed = schema.safeParse(input);
    if (!parsed.success) return state("error", "输入无效，请检查必填项、数量、金额和版本后重试。");
    const result = await work(owner, parsed.data);
    if (!result.ok) return state("error", result.message ?? `操作未保存（${result.code ?? "unknown"}），请刷新后检查。`);
    revalidatePath("/ops"); revalidatePath("/");
    return state("success", success);
  } catch (error) {
    // Do not log order addresses, form bodies, credentials or database statements.
    console.error("Admin operation failed", error instanceof Error ? error.name : "unknown_error");
    const message = error instanceof Error ? error.message : "";
    if (message === "shipping_route_overlap") return state("error", "同一国家和配送方式已有启用规则，请先停用旧规则再保存。");
    if (message === "shipping_carrier_unavailable") return state("error", "请选择本店已启用的承运商。");
    if (/^invalid_shipping_/.test(message)) return state("error", "物流配置无效，请检查国家、费用、重量、时效和 HTTPS 跟踪链接模板。");
    return state("error", "未能保存，请确认后台登录有效并刷新重试。");
  }
}

export async function reviewOrderAction(_previous: OpsActionState, data: FormData) {
  return execute(z.object({ orderNumber, expectedVersion: version, decision: z.enum(["confirm", "cancel"]), note }),
    { orderNumber: data.get("orderNumber"), expectedVersion: data.get("expectedVersion"), decision: data.get("decision"), note: data.get("note") },
    (owner, value) => reviewOrder(owner, value.orderNumber, value.expectedVersion, value.decision, value.note),
    "订单审核已保存。资料确认不代表收款；未付款仍禁止发货。");
}
export async function createShipmentAction(_previous: OpsActionState, data: FormData) {
  return execute(z.object({ orderNumber, expectedVersion: version, fulfillmentMode: z.enum(fulfillmentModes),
    carrierCode: id, trackingNumber: z.string().trim().min(1).max(128), lines, note: z.string().trim().max(1000) }),
    { orderNumber: data.get("orderNumber"), expectedVersion: data.get("expectedVersion"), fulfillmentMode: data.get("fulfillmentMode"),
      carrierCode: data.get("carrierCode"), trackingNumber: data.get("trackingNumber"), lines: parsedLines(data), note: data.get("note") ?? "" },
    (owner, value) => createShipment(owner, value.orderNumber, value.expectedVersion, value),
    "包裹发货已登记，库存已按实际发货数量扣减；本操作不会向物流商下单。");
}
export async function updateShipmentAction(_previous: OpsActionState, data: FormData) {
  return execute(z.object({ shipmentId: id, expectedVersion: version, status: z.enum(["shipped", "transit", "delivered"]), note,
    trackingNumber: z.string().trim().min(1).max(100).optional() }),
    { shipmentId: data.get("shipmentId"), expectedVersion: data.get("expectedVersion"), status: data.get("status"), note: data.get("note"),
      trackingNumber: data.get("trackingNumber") ?? undefined },
    (owner, value) => updateShipment(owner, value.shipmentId, value.expectedVersion, value),
    "物流节点已人工登记并记录操作历史。");
}
export async function createAfterSaleAction(_previous: OpsActionState, data: FormData) {
  return execute(z.object({ orderNumber, expectedVersion: version, kind: z.enum(["return", "refund"]), reason: note, lines, amountCents: cents }),
    { orderNumber: data.get("orderNumber"), expectedVersion: data.get("expectedVersion"), kind: data.get("kind"),
      reason: data.get("reason"), lines: parsedLines(data), amountCents: data.get("amountCents") },
    (owner, value) => createAfterSale(owner, value.orderNumber, value.expectedVersion, value),
    "售后申请已受理，不会执行资金退款。");
}
export async function updateAfterSaleAction(_previous: OpsActionState, data: FormData) {
  return execute(z.object({ caseId: id, expectedVersion: version, action: z.enum(["approve", "reject", "receive", "queue_refund", "close"]), note, restock: z.boolean() }),
    { caseId: data.get("caseId"), expectedVersion: data.get("expectedVersion"), action: data.get("action"), note: data.get("note"), restock: checkbox(data, "restock") },
    (owner, value) => updateAfterSale(owner, value.caseId, value.expectedVersion, value),
    "售后处理已保存。待退款仅为账务待办，不代表已退款。");
}
export async function saveShippingRuleAction(_previous: OpsActionState, data: FormData) {
  return execute(z.object({ id, name: z.string().trim().min(1).max(100), method: z.enum(shippingMethods),
    countries: z.array(z.enum(shippingCountries)).min(1).max(6), baseCents: cents, includedWeightGrams: whole,
    stepWeightGrams: whole.refine((value) => value > 0 && value <= 1000000), stepCents: cents,
    freeAboveCents: z.union([z.literal("").transform(() => null), cents]),
    minDays: whole, maxDays: whole, carrierCode: z.string().trim().max(64).transform((value) => value || null),
    enabled: z.boolean(), expectedVersion: configVersion }),
    { id: data.get("id"), name: data.get("name"), method: data.get("method"),
      countries: data.getAll("countries").flatMap((value) => String(value).split(",").map((code) => code.trim()).filter(Boolean)),
      baseCents: data.get("baseCents"), includedWeightGrams: data.get("includedWeightGrams"), stepWeightGrams: data.get("stepWeightGrams"),
      stepCents: data.get("stepCents"), freeAboveCents: data.get("freeAboveCents") ?? "", minDays: data.get("minDays"), maxDays: data.get("maxDays"),
      carrierCode: data.get("carrierCode") ?? "", enabled: checkbox(data, "enabled"), expectedVersion: data.get("expectedVersion") },
    async (owner, value) => ({ ok: await saveShippingRule(owner, value), message: "配置已被其他人修改，请刷新后重试。" }), "运费规则已保存，商城报价将按此配置计算。");
}
export async function saveCarrierAction(_previous: OpsActionState, data: FormData) {
  return execute(z.object({ code: id, name: z.string().trim().min(1).max(100), trackingUrlTemplate: z.string().trim().min(1).max(2048), enabled: z.boolean(), expectedVersion: configVersion }),
    { code: data.get("code"), name: data.get("name"), trackingUrlTemplate: data.get("trackingUrlTemplate"), enabled: checkbox(data, "enabled"), expectedVersion: data.get("expectedVersion") },
    async (owner, value) => ({ ok: await saveCarrier(owner, value), message: "配置已被其他人修改，请刷新后重试。" }), "承运商配置已保存。保存链接模板不会自动开通物流商接口。");
}
