"use server";

import { revalidatePath } from "next/cache";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { addProductStock, setOrderStatus } from "@/db/ops";
import { orderStatuses } from "@/lib/ops-types";

export type OpsActionState = {
  kind: "idle" | "success" | "error";
  message: string;
  eventId: number;
};

export const initialOpsActionState: OpsActionState = {
  kind: "idle",
  message: "",
  eventId: 0,
};

const orderStatusSchema = z.object({
  orderNumber: z.string().regex(/^(?:MW|HW)-\d{5,8}$/),
  status: z.enum(orderStatuses),
});

const stockSchema = z.object({
  sku: z.string().min(3).max(32),
  quantity: z.coerce.number().int().min(1).max(100),
});

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
  });
  if (!parsed.success) return actionError("Choose a valid order status.");

  try {
    const result = await setOrderStatus(
      user.userId,
      parsed.data.orderNumber,
      parsed.data.status
    );
    if (result === "not_found") return actionError("That order could not be found.");
    if (result === "unpaid") return actionError("Payment must be completed before fulfillment can start.");

    revalidatePath("/ops");
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
  });
  if (!parsed.success) return actionError("Choose a valid restock amount.");

  try {
    const changed = await addProductStock(
      user.userId,
      parsed.data.sku,
      parsed.data.quantity
    );
    if (!changed) return actionError("That product could not be found.");

    revalidatePath("/ops");
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

function actionError(message: string): OpsActionState {
  return { kind: "error", message, eventId: Date.now() };
}

function isStoreOwner(userId: string) {
  const ownerId = (env as unknown as Record<string, string | undefined>).STORE_OWNER_ID?.trim();
  return Boolean(ownerId && ownerId === userId);
}
