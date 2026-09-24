import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";
import { demoSnapshot, getOpsSnapshot } from "@/db/ops";

import { OpsDashboard } from "./ops-dashboard";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const user = await getChatGPTUser();
  let snapshot = demoSnapshot;
  let databaseAvailable = true;

  if (user) {
    try {
      snapshot = await getOpsSnapshot(user.userId);
    } catch (error) {
      databaseAvailable = false;
      console.error("Operations workspace unavailable", error);
    }
  }

  return (
    <OpsDashboard
      snapshot={snapshot}
      databaseAvailable={databaseAvailable}
      user={
        user
          ? {
              displayName: user.displayName,
              email: user.email,
              signOutPath: chatGPTSignOutPath("/ops"),
            }
          : null
      }
      signInPath={chatGPTSignInPath("/ops")}
    />
  );
}
