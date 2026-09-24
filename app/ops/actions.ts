"use server";

import { revalidatePath } from "next/cache";
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
  orderNumber: z.string().regex(/^(?:MW|HW)-\d{5}$/),
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

  const parsed = orderStatusSchema.safeParse({
    orderNumber: formData.get("orderNumber"),
    status: formData.get("status"),
  });
  if (!parsed.success) return actionError("Choose a valid order status.");

  try {
    const changed = await setOrderStatus(
      user.userId,
      parsed.data.orderNumber,
      parsed.data.status
    );
    if (!changed) return actionError("That order could not be found.");

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
