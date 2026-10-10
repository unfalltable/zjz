import { createPendingOrder } from "@backend/services/checkout";
import { errorResponse, json, readJson } from "./json";
export async function POST(request: Request) {
  try {
    const result = await createPendingOrder(await readJson(request));
    return json(result, result.ok ? 200 : result.status);
  } catch (error) { return errorResponse(error); }
}
