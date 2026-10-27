import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountClientError, accountCodeRequest, accountErrorMessage } from "./account-client.ts";

for (const channel of ["email", "phone"]) {
  for (const [mode, purpose] of [["register", "register"], ["code", "login"], ["reset", "reset"]]) {
    test(`${channel} ${mode} UI request uses the exact backend endpoint and purpose`, () => {
      const contact = channel === "email" ? { email: "fixture@example.test" } : { phone: "2025550123", phone_country_code: "+1" };
      const result = accountCodeRequest(mode, channel, contact, "test-only-captcha");
      assert.equal(result.path, `${channel}/${mode === "register" ? "" : "login/"}send-code`);
      assert.deepEqual(result.body, { ...contact, captcha_token: "test-only-captcha", purpose });
      assert.equal(Object.hasOwn(contact, "purpose"), false);
    });
  }
}
test("common account failures are localized without showing internal upstream error strings", () => {
  const error = new AccountClientError("credentials_invalid", "internal-value-must-not-be-used");
  for (const language of ["en", "zh", "es"]) assert.ok(!accountErrorMessage(error, language).includes("internal-value"));
  assert.match(accountErrorMessage(error, "en"), /incorrect/);
  assert.match(accountErrorMessage(error, "zh"), /错误/);
  assert.match(accountErrorMessage(error, "es"), /incorrecto/);
  assert.doesNotMatch(accountErrorMessage(new AccountClientError("new_unknown_code", "未知错误细节"), "en"), /未知/);
});
