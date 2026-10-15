import { requireStoreOperator } from "@backend/http/admin-access";
import { getProductVariants } from "@backend/db/variants";
import { errorResponse, HttpError, json } from "@backend/http/json";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const owner = await requireStoreOperator(request);
    const sku = new URL(request.url).searchParams.get("sku") ?? "";
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(sku)) throw new HttpError(400, "Provide a main product SKU.");
    const variants = await getProductVariants(owner, sku);
    if (!variants) throw new HttpError(404, "The main product was not found.");
    return json({ ok: true, rootSku: sku, variants });
  } catch (error) { return errorResponse(error); }
}
