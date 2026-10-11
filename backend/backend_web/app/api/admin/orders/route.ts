import { z } from "zod";
import { requireStoreOperator } from "@backend/http/admin-access";
import { getAdminOrders } from "@backend/db/admin-commerce";
import { errorResponse, HttpError, json } from "@backend/http/json";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const owner = await requireStoreOperator(request);
    const url = new URL(request.url);
    const query = z.object({ search: z.string().trim().max(120), page: z.coerce.number().int().min(1).max(100000), review: z.enum(["all", "unreviewed", "confirmed", "cancelled"]) })
      .safeParse({ search: url.searchParams.get("search") ?? "", page: url.searchParams.get("page") ?? "1", review: url.searchParams.get("review") ?? "all" });
    if (!query.success) throw new HttpError(422, "Invalid order search or page.");
    return json({ ok: true, ...await getAdminOrders(owner, query.data.search, query.data.page, query.data.review) });
  } catch (error) { return errorResponse(error); }
}
