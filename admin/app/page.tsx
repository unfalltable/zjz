import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "@backend/auth";
import { env } from "cloudflare:workers";
import { demoSnapshot, getOpsSnapshot } from "@backend/db/ops";

import { OpsDashboard } from "./ops-dashboard";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const user = await getChatGPTUser();
  const ownerId = (env as unknown as Record<string, string | undefined>).STORE_OWNER_ID?.trim();
  const owner = user && ownerId === user.userId ? user : null;
  const runtime = env as unknown as Record<string, string | undefined>;
  const configuredStore = runtime.STOREFRONT_URL?.trim();
  const storefrontUrl = configuredStore && /^https?:\/\//.test(configuredStore)
    ? configuredStore : runtime.APP_SURFACE === "admin" ? null : "/";
  let snapshot = demoSnapshot;
  let databaseAvailable = true;

  if (owner) {
    try {
      snapshot = await getOpsSnapshot(owner.userId);
    } catch (error) {
      databaseAvailable = false;
      console.error("Operations workspace unavailable", error);
    }
  }

  return (
    <OpsDashboard
      snapshot={snapshot}
      storefrontUrl={storefrontUrl}
      databaseAvailable={databaseAvailable}
      user={
        owner
          ? {
              displayName: owner.displayName,
              email: owner.email,
              signOutPath: chatGPTSignOutPath("/ops"),
            }
          : null
      }
      signInPath={chatGPTSignInPath("/ops")}
    />
  );
}
