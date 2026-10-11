import { requireStoreOperator } from "@backend/http/admin-access";
import { getShippingSettings } from "@backend/db/shipping";
import { errorResponse, json } from "@backend/http/json";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const owner = await requireStoreOperator(request);
    return json({ ok: true, settings: await getShippingSettings(owner) });
  } catch (error) { return errorResponse(error); }
}
