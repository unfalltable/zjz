import { requireStoreOperator } from "@backend/http/admin-access";
import { getAdminOrderDetail } from "@backend/db/admin-commerce";
import { errorResponse, HttpError, json } from "@backend/http/json";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ number: string }> }) {
  try {
    const owner = await requireStoreOperator(request);
    const { number } = await context.params;
    if (!/^(?:MW|HW)-\d{5,8}$/.test(number)) throw new HttpError(422, "Invalid order number.");
    const order = await getAdminOrderDetail(owner, number);
    if (!order) throw new HttpError(404, "Order not found.");
    return json({ ok: true, order });
  } catch (error) { return errorResponse(error); }
}
