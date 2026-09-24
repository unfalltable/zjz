import { TrackClient } from "./track-client";

export const dynamic = "force-dynamic";

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const params = await searchParams;
  return <TrackClient initialOrderNumber={params.order ?? ""} />;
}
