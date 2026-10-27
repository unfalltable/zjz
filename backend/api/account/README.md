# Canonical account service

This is the running integration of the supplied `完整版账号登录模块.zip` (module documentation dated 2026-10-24). The module boundaries and original account routes are retained, with production safety corrections. It replaces the old monolithic account implementation; the files under `../user_account/` are thin compatibility imports, not a second server. Previous implementations remain recoverable in Git history.

## Start and storage

From `backend/api/`:

```sh
npm ci
npm run test:account
npm run start:account
```

Copy `.env.example` to the ignored `.env` and configure a dedicated MySQL account database and Redis. The default listener is **127.0.0.1:3002**. Existing server port 3001 belongs to another application and must not be replaced. `MYSQL_*` is preferred; the source package's `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` aliases remain supported. Do not use a root database account or an existing unrelated database.

The reviewed schema is `backend/sql/account/0000_account_schema.mysql.sql`; the startup readiness audit uses `audit-schema.cjs` in the same directory. Production startup checks metadata only (`scanData:false`) and refuses an incompatible schema. It never runs DDL, imports the supplied broken SQL, updates old account data, or touches the commerce SQLite migrations. Existing account databases require a separate reviewed migration by their operator; do not run the new-database schema against an existing database.

Avatar storage uses the absolute persistent `ACCOUNT_UPLOAD_PATH`, outside release and static directories. Only JPEG/PNG/WebP inputs are accepted, decoded and reencoded into metadata-free WebP, with byte/pixel/dimension limits. The fresh server-assigned filename is unrelated to the uploaded filename. Public reads accept only `/api/account/avatar/files/<32 lowercase hex>.webp`. Default directory ceilings are 20,000 files and 1 GiB; upload rates are limited by IP and user. The ceilings are operational safeguards, not a distributed storage quota service. Do not expose an arbitrary `/uploads/**` directory.

## HTTP contracts

Responses keep `{success,message,data}`; failures also contain a non-sensitive `code`. The safe session user is:

```text
user_id (string), nickname, avatar_url, email, backup_email,
phone (national number), phone_country_code (canonical +calling-code),
country, status, has_google, has_apple, created_at, last_login_at
```

No password hash, raw provider subject, internal auth version, or login IP is included. `/api/account/me` returns this object directly in `data`, preserving the latest remote implementation's shape.

- `GET /health`: generic readiness response; no secrets or database addresses.
- `GET /api/account/config`: public capability flags `email/sms/google/apple/password/avatar` and non-sensitive configuration codes. Missing providers are false, not falsely connected.
- `POST /api/account/captcha/image`: returns `{captcha_id,image,expires_in}`. The image is a PNG data URL.
- `POST /api/account/captcha/image/verify`: `{captcha_id,code}` (or `text`) returns `{captcha_token,expires_in}`.
- Slider generation/verification paths are retained for compatible clients. The password route also accepts `captcha_token`, so accessible clients do not have to drag a puzzle.
- `POST /api/account/email/send-code` / `phone/send-code`: `{email|phone,phone_country_code?,captcha_token}` produces a registration/new-contact proof.
- `POST /api/account/email/login/send-code` / `phone/login/send-code`: optional `purpose` is `login` (default), `reset`, or `security`. Security delivery requires a session and targets the user's existing contact, never a supplied replacement contact.
- `POST /api/account/backup-email/send-code`: requires a session; `purpose=bind` verifies a new backup email; `purpose=security` targets the current backup email.
- `POST /api/account/email/register` / `phone/register`: `{email|phone,phone_country_code?,password,code,nickname?,country?,platform}`. New MySQL IDs are server-generated auto-increment BIGINT values, returned as strings. Phone numbers use libphonenumber metadata rather than arbitrary prefix concatenation.
- `POST /api/account/login/password`: `{account,password,captcha_token,phone_country_code?,platform}`; legacy `{captcha_id,x}` is also accepted after atomic slider verification.
- `POST /api/account/login/email/code` / `phone/code`: `{email|phone,phone_country_code?,code,platform}`.
- `POST /api/account/token/check`, `token/refresh`, `logout`, `me`, `nickname`, `avatar`, `restrictions`: original paths retained.

Login/registration retains `data.user_id/account/account_type/expires_in`, with an additional safe `data.user` object. Native consumers using `platform=app` also receive `data.token`. Web responses omit the token and use an HttpOnly/Secure production `token` cookie. The storefront's **same-origin Web gateway** translates this cookie to its own customer-cookie name and defensively removes any returned session tokens; browser JavaScript must not persist the account token. Native clients must use their configured account API deployment, not rely on this browser-only cookie gateway.

Sensitive changes retain the supplied paths: `password/change`, `password/reset`, `email/bind`, `phone/bind`, `backup-email/bind`, `backup-email/delete`, `email/unbind`, `phone/unbind`, `oauth/bind`, `oauth/unbind`, `delete/apply`. They require a live session plus current-password or purpose-specific security-code proof where applicable. For contact changes using codes, `code_type + code` verifies the old contact and `new_code` verifies the new contact. Password reset only accepts `purpose=reset` codes; ordinary login codes cannot reset passwords. Passwords require at least 8 characters and at most 72 UTF-8 bytes.

Account updates use MySQL transactions and row locks. Removing the last configured usable login method is refused. Password changes/reset, binding changes, and deletion applications increment `auth_version`; every authenticated request compares it and checks active login restrictions, invalidating old sessions on all devices. A deletion application only records the request and logs devices out; it does not claim that an account has already been deleted.

## Provider and security boundaries

- SMTP and optional Twilio SMS must actually accept delivery before a new usable OTP is stored. Missing providers return 503; no dummy send or code logging is permitted.
- OTPs are contact- and purpose-scoped, hashed at rest in Redis, attempted at most five times, and atomically consumed. A captcha proof is short-lived, client-IP-bound and single-use. Contact cooldowns and IP limits apply.
- Session tokens are 256-bit random values; Redis keys contain a hash rather than the token. Refresh does not recreate a logged-out session and absolute session age is capped.
- CORS is an explicit origin allowlist. Cookie-authenticated POSTs require a trusted Origin. For deployment behind a known loopback proxy, set `ACCOUNT_TRUST_PROXY=loopback` only when that proxy replaces client-supplied forwarding headers. Do not set unconditional proxy trust.
- Google/Apple require `ACCOUNT_OAUTH_ENABLED=true`, full provider credentials, and a public HTTPS origin. Redirect URIs are derived from that origin. Web state is bound to the HttpOnly `account_oauth_state` transaction cookie and single-use Redis state, with nonce/issuer/audience/expiry verification. Callbacks redirect to fixed `/account` without tokens in URLs. The Apple transaction cookie is temporary SameSite=None/Secure; the account session remains SameSite=Lax. Native identity tokens must be freshly issued; they are verified server-side and are never replaced by caller-supplied raw user IDs. A provider email match does not automatically link an existing account.
- Previously embedded credentials in the supplied/old source must be rotated by their owner. No credentials are copied into the new modules, examples, logs or tests.
- Birth/divination profile routes from the package are present but disabled by default (`ACCOUNT_PROFILE_BIRTH_ENABLED=false`) and are not requested by the shopping UI. Payment and unrelated divination services are not mounted.

The test suite uses injected MySQL/Redis/provider fixtures and synthetic images only. It does not send real messages, contact real OAuth providers, modify a real account database, or certify a live provider deployment. Real MySQL/Redis, provider credentials, callback registration, and delivery verification remain deployment prerequisites.
