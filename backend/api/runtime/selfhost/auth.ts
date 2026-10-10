import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  selfhostSignInPath,
  selfhostSignOutPath,
  verifySelfhostAdmin,
} from "./admin-auth.mjs";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

// This module is selected only by the standalone Node build. Never use Sites
// headers as identity here: public clients can forge those headers themselves.
export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  if (process.env.APP_SURFACE !== "admin") return null;
  const requestHeaders = await headers();
  return verifySelfhostAdmin(requestHeaders.get("authorization"), process.env);
}

export async function requireChatGPTUser(_returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;
  // OpsPage calls getChatGPTUser (not requireChatGPTUser), so this terminates at
  // its read-only lock page rather than a missing callback or redirect loop.
  redirect(selfhostSignInPath());
}

export function chatGPTSignInPath(_returnTo: string): string {
  return selfhostSignInPath();
}

export function chatGPTSignOutPath(_returnTo = "/"): string {
  return selfhostSignOutPath();
}
