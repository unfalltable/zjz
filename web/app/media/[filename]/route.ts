import { GET as readMedia } from "@backend/http/media";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ filename: string }> }) {
  return readMedia(request, (await context.params).filename);
}
