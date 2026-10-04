"use server";

import { createPendingOrder, type CreateOrderResult } from "@backend/services/checkout";

export type { CreateOrderResult } from "@backend/services/checkout";

export async function createPendingOrderAction(input: unknown): Promise<CreateOrderResult> {
  return createPendingOrder(input);
}
