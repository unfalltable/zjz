import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  selfhostSignInPath,
  selfhostSignOutPath,
  verifySelfhostAdmin,
} from "../backend/api/runtime/selfhost/admin-auth.mjs";

const testPassword = "unit-test-only:private-password";
const configuration = {
  APP_SURFACE: "admin",
  MIOVA_ADMIN_USERNAME: "operator",
  MIOVA_ADMIN_PASSWORD_SHA256: createHash("sha256").update(testPassword).digest("hex"),
  STORE_OWNER_ID: "test-store-owner",
  MIOVA_ADMIN_EMAIL: "operator@example.test",
  MIOVA_ADMIN_DISPLAY_NAME: "Store operator",
};
const basic = (username = "operator", password = testPassword) =>
  `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;

test("standalone admin identity comes only from verified credentials and server configuration", () => {
  assert.deepEqual(verifySelfhostAdmin(basic(), configuration), {
    userId: "test-store-owner", displayName: "Store operator", email: "operator@example.test", fullName: "Store operator",
  });
  assert.equal(verifySelfhostAdmin(basic("attacker"), configuration), null);
  assert.equal(verifySelfhostAdmin(basic("operator", "wrong"), configuration), null);
  assert.equal(verifySelfhostAdmin(null, configuration), null);
});

test("public storefront can never become admin, including forged Sites headers or valid admin Basic", () => {
  for (const APP_SURFACE of [undefined, "", "web", "ADMIN", "admin "]) {
    const forgedIdentity = { ...configuration, APP_SURFACE, "oai-authenticated-user-id": "test-store-owner", "oai-authenticated-user-email": "attacker@example.test" };
    assert.equal(verifySelfhostAdmin(basic(), forgedIdentity), null);
    assert.equal(verifySelfhostAdmin(undefined, forgedIdentity), null);
  }
  assert.equal(verifySelfhostAdmin(undefined, {
    ...configuration, "oai-authenticated-user-id": "test-store-owner", "oai-authenticated-user-email": "operator@example.test",
  }), null);
});

test("missing or invalid deployment auth configuration fails closed", () => {
  for (const field of ["MIOVA_ADMIN_USERNAME", "MIOVA_ADMIN_PASSWORD_SHA256", "STORE_OWNER_ID", "MIOVA_ADMIN_EMAIL"]) {
    assert.equal(verifySelfhostAdmin(basic(), { ...configuration, [field]: undefined }), null);
    assert.equal(verifySelfhostAdmin(basic(), { ...configuration, [field]: "" }), null);
  }
  for (const [field, value] of [
    ["MIOVA_ADMIN_USERNAME", " operator"], ["MIOVA_ADMIN_USERNAME", "operator:"],
    ["MIOVA_ADMIN_USERNAME", "operator\n"], ["MIOVA_ADMIN_PASSWORD_SHA256", "not-a-hash"],
    ["MIOVA_ADMIN_PASSWORD_SHA256", "a".repeat(63)], ["STORE_OWNER_ID", "test store"],
    ["STORE_OWNER_ID", "../store"], ["MIOVA_ADMIN_EMAIL", "invalid-email"],
    ["MIOVA_ADMIN_EMAIL", "operator@example.test\r\nInjected: yes"],
  ]) assert.equal(verifySelfhostAdmin(basic(), { ...configuration, [field]: value }), null);
});

test("malformed and oversized Authorization headers are rejected without exceptions", () => {
  const validToken = basic().slice(6);
  for (const header of [
    "", "Basic", "Bearer value", "Basic %%%%", "Basic Og==", "Basic b3BlcmF0b3I=",
    `Basic ${validToken}=`, `Basic ${validToken}\n`, `Basic ${validToken},ignored`,
    "Basic " + "A".repeat(5000), basic("operator", ""), basic("operator", "x".repeat(1025)),
    basic("operator", "password\n"), "Basic " + Buffer.from([0xff, 0x3a, 0xff]).toString("base64"),
  ]) assert.equal(verifySelfhostAdmin(header, configuration), null, header.slice(0, 40));
});

test("Basic supports case-insensitive scheme, UTF-8 and colons in passwords", () => {
  assert.notEqual(verifySelfhostAdmin(basic().replace("Basic", "bAsIc"), configuration), null);
  const password = "私有:密钥";
  const unicodeConfig = { ...configuration, MIOVA_ADMIN_USERNAME: "店主", MIOVA_ADMIN_PASSWORD_SHA256: createHash("sha256").update(password).digest("hex").toUpperCase() };
  assert.notEqual(verifySelfhostAdmin(basic("店主", password), unicodeConfig), null);
});

test("optional display name does not affect authorization and unsafe names are omitted", () => {
  for (const name of [undefined, "", "bad\nname", "x".repeat(161)]) {
    assert.deepEqual(verifySelfhostAdmin(basic(), { ...configuration, MIOVA_ADMIN_DISPLAY_NAME: name }), {
      userId: "test-store-owner", displayName: "Store administrator", email: "operator@example.test", fullName: null,
    });
  }
});

test("standalone login links stay on the lock page without nonexistent Sites callbacks", () => {
  assert.equal(selfhostSignInPath("https://attacker.invalid"), "/ops?selfhost_auth=required");
  assert.equal(selfhostSignOutPath("//attacker.invalid"), "/ops?selfhost_auth=close-session");
});
