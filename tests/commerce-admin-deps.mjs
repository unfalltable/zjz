import { env } from "./commerce-test-env.mjs";

export async function getChatGPTUser() {
  return env.TEST_USER ?? null;
}

export function revalidatePath() {
  // Cache invalidation is deliberately inert in isolated action tests.
}
