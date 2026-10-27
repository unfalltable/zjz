'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, readdir, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcrypt');
const sharp = require('sharp');
const { createAccountApp } = require('../api_server.cjs');
const { createCommon, readConfig, phoneParts, normalizePhone, sessionKey, publicUser } = require('../common/common.cjs');

const user = { id: '9007199254740993', email: 'buyer@example.test', backup_email: 'backup@example.test', phone: '2025550123', phone_country_code: '+1', nickname: 'Fixture Buyer', avatar_url: null,
  password: '$2b$04$c5ZMlYtQZNIFVHjWXjh1OegTiLAqXqIG1zaQjMtEvucmWjs1hZsHm', status: 1, auth_version: 0, google_sub: 'private-google-id', apple_sub: null, created_at: '2026-01-01', last_login_at: '2026-10-27' };
function fixture(env = {}) {
  const values = new Map(), calls = [], restrictions = [], users = [{ ...user }];
  const redisClient = {
    async get(key) { return values.get(key) ?? null; },
    async getDel(key) { const value = values.get(key) ?? null; values.delete(key); return value; },
    async set(key, value, options = {}) { if (options.NX && values.has(key)) return null; values.set(key, String(value)); return 'OK'; },
    async del(key) { return values.delete(key) ? 1 : 0; },
    async eval(script, { keys, arguments: args }) {
      const key = keys[0];
      if (script.includes("'INCR'")) { const next = Number(values.get(key) || 0) + 1; values.set(key, next); return next; }
      const raw = values.get(key); if (!raw) return 0;
      if (script.includes('v.attempts')) { const value = JSON.parse(raw); if (value.hash === args[0]) { values.delete(key); return 1; } if (++value.attempts >= 5) values.delete(key); else values.set(key, JSON.stringify(value)); return 0; }
      if (script.includes("'SET'")) return raw === args[0] ? 1 : 0;
      if (raw !== args[0]) return 0; values.delete(key); return 1;
    },
  };
  const dbPool = { async execute(sql, params = []) {
    calls.push({ sql, params });
    if (/FROM account_restrictions/.test(sql)) return [restrictions];
    if (/^SELECT \* FROM users/.test(sql)) {
      const row = /WHERE id/.test(sql) ? users.find(item => String(item.id) === String(params[0])) : /WHERE email/.test(sql) ? users.find(item => item.email === params[0]) : /WHERE phone/.test(sql) ? users.find(item => item.phone === params[0] && item.phone_country_code === params[1]) : users.find(item => item.google_sub === params[0] || item.apple_sub === params[0]);
      return [row ? [{ ...row }] : []];
    }
    if (/^SELECT avatar_url/.test(sql)) return [[{ avatar_url: users[0].avatar_url }]];
    if (/^SELECT id FROM account_deletion_requests/.test(sql)) return [[]];
    if (/^INSERT INTO users/.test(sql)) {
      if (users.some(item => (params[0] && item.email === params[0]) || (params[1] && item.phone === params[1] && item.phone_country_code === params[2]))) throw Object.assign(new Error('private database internals'), { code: 'ER_DUP_ENTRY' });
      const id = '9007199254740995'; users.push({ id, email: params[0], phone: params[1], phone_country_code: params[2], password: params[3], nickname: params[4], status: 1, auth_version: 0 }); return [{ insertId: id, affectedRows: 1 }];
    }
    if (/^UPDATE users SET avatar_url/.test(sql)) { users[0].avatar_url = params[0]; return [{ affectedRows: 1 }]; }
    if (/auth_version = auth_version \+ 1/.test(sql)) users[0].auth_version++;
    if (/^UPDATE users SET password/.test(sql)) users[0].password = params[0];
    return [{ affectedRows: 1 }];
  }, async getConnection() { return { execute: this.execute.bind(this), async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} }; } };
  const config = readConfig({ NODE_ENV: 'test', ACCOUNT_PUBLIC_ORIGIN: 'http://127.0.0.1:5173', ...env });
  const delivery = { capabilities: { email: false, sms: false } };
  const dependencies = { dbPool, redisClient, config, delivery };
  const common = createCommon(dependencies);
  async function session(overrides = {}) { const token = 'a'.repeat(64); values.set(sessionKey(token), JSON.stringify({ user_id: user.id, auth_version: '0', issued_at: Math.floor(Date.now() / 1000), verified_at: Math.floor(Date.now() / 1000), ...overrides })); return token; }
  return { dependencies, common, values, calls, users, restrictions, session };
}
async function server(t, value) {
  const app = createAccountApp(value.dependencies);
  const running = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(async () => { running.closeAllConnections(); await new Promise(resolve => running.close(resolve)); });
  const base = `http://127.0.0.1:${running.address().port}`;
  async function request(url, body = {}, headers = {}, method = 'POST') {
    const response = await fetch(`${base}${url}`, { method, headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000), redirect: 'manual' });
    return { response, status: response.status, body: await response.json() };
  }
  return { request, base };
}
function authenticated(token) { return { Cookie: `token=${token}`, Origin: 'http://127.0.0.1:5173' }; }

test('phone metadata canonicalizes international identities and refuses arbitrary prefixes', () => {
  assert.deepEqual(phoneParts('+1', '(202) 555-0123'), { e164: '+12025550123', countryCode: '+1', nationalNumber: '2025550123' });
  assert.equal(normalizePhone('+12', '+12025550123'), null);
  assert.equal(normalizePhone('+999', '2025550123'), null);
  assert.equal(normalizePhone('+44', '+12025550123'), null);
  assert.equal(normalizePhone('', '+12025550123'), '+12025550123');
});
test('public user DTO never includes credentials, provider subjects or raw session metadata', () => {
  const result = publicUser(user); assert.equal(result.user_id, '9007199254740993'); assert.equal(result.has_google, true);
  for (const key of ['password', 'google_sub', 'apple_sub', 'auth_version', 'token', 'last_login_ip']) assert.equal(key in result, false);
});
test('module factories do not open listeners or connect to account databases', () => {
  const value = fixture(); const app = createAccountApp(value.dependencies); assert.equal(typeof app, 'function'); assert.equal(value.calls.length, 0); assert.equal(value.values.size, 0);
});
test('capabilities fail closed without delivery/OAuth and never serialize env secrets', async t => {
  const value = fixture({ GOOGLE_CLIENT_SECRET: 'fixture-never-return-this', ACCOUNT_SMTP_PASSWORD: 'fixture-secret' }); const { request } = await server(t, value);
  const result = await request('/api/account/config', {}, {}, 'GET'); assert.equal(result.status, 200);
  assert.deepEqual([result.body.data.email, result.body.data.sms, result.body.data.google, result.body.data.apple], [false, false, false, false]);
  assert.equal(JSON.stringify(result.body).includes('fixture-secret'), false); assert.equal(JSON.stringify(result.body).includes('fixture-never-return-this'), false);
  for (const provider of ['google', 'apple']) assert.equal((await request(`/api/account/${provider}/login`, {}, {}, 'GET')).status, 503);
});
test('foreign origins and originless cookie POSTs are rejected before database access', async t => {
  const value = fixture(); const token = await value.session(); const { request } = await server(t, value);
  for (const headers of [{ Cookie: `token=${token}`, Origin: 'https://attacker.example' }, { Cookie: `token=${token}` }, { Origin: 'https://attacker.example' }]) assert.equal((await request('/api/account/me', {}, headers)).status, 403);
  assert.equal(value.calls.length, 0);
});
test('every authenticated request rechecks user status, auth version and active restrictions', async t => {
  const value = fixture(); const token = await value.session(); const { request } = await server(t, value);
  let result = await request('/api/account/me', {}, authenticated(token)); assert.equal(result.status, 200); assert.equal(result.body.data.user_id, user.id); assert.equal(result.body.data.password, undefined);
  value.users[0].status = 0; assert.equal((await request('/api/account/me', {}, authenticated(token))).status, 401);
  value.users[0].status = 1; value.users[0].auth_version = 1; assert.equal((await request('/api/account/me', {}, authenticated(token))).status, 401);
  value.users[0].auth_version = 0; value.restrictions.push({ restriction_type: 'all' }); assert.equal((await request('/api/account/me', {}, authenticated(token))).status, 401);
});
test('Bearer native identity is supported without weakening cookie token precedence', async t => {
  const value = fixture(); const token = await value.session(); const { request } = await server(t, value);
  assert.equal((await request('/api/account/me', {}, { Authorization: `Bearer ${token}` })).status, 200);
  assert.equal((await request('/api/account/me', { token: 'b'.repeat(64) }, { Authorization: `Bearer ${token}` })).status, 401);
});
test('logout revokes the token and refresh cannot revive a logged-out session', async t => {
  const value = fixture(); const token = await value.session(); const { request } = await server(t, value);
  assert.equal((await request('/api/account/token/refresh', {}, authenticated(token))).status, 200);
  const logout = await request('/api/account/logout', {}, authenticated(token)); assert.equal(logout.status, 200); assert.match(logout.response.headers.get('set-cookie'), /token=;/);
  assert.equal((await request('/api/account/token/refresh', {}, authenticated(token))).status, 401);
});
test('captcha capabilities are IP-bound single-use proofs and wrong IP does not consume them', async () => {
  const value = fixture(); const req = { ip: '192.0.2.1' }; const token = await value.common.setCaptchaToken(req);
  assert.equal(await value.common.consumeCaptchaToken({ ip: '192.0.2.2' }, token), false);
  assert.equal(await value.common.consumeCaptchaToken(req, token), true); assert.equal(await value.common.consumeCaptchaToken(req, token), false);
});
test('OTP purpose separation and five-attempt consumption are enforced by the common runtime', async () => {
  const value = fixture(); await value.common.storeCode('email_login', user.email, '123456');
  assert.equal(await value.common.consumeCode('email_reset', user.email, '123456'), false);
  for (let i = 0; i < 5; i++) assert.equal(await value.common.consumeCode('email_login', user.email, '000000'), false);
  assert.equal(await value.common.consumeCode('email_login', user.email, '123456'), false);
  await value.common.storeCode('email_login', user.email, '123456');
  const result = await Promise.all([value.common.consumeCode('email_login', user.email, '123456'), value.common.consumeCode('email_login', user.email, '123456')]);
  assert.deepEqual(result.sort(), [false, true]);
});
test('signup uses server-assigned bigint IDs, canonical contact data and guarded Web cookies', async t => {
  const value = fixture({ ACCOUNT_COOKIE_SECURE: 'true' }); const { request } = await server(t, value);
  await value.common.storeCode('email_register', 'new@example.test', '654321');
  const result = await request('/api/account/email/register', { email: 'New@example.test', password: 'A-test-password-2026', code: '654321', nickname: 'New Buyer', platform: 'web' });
  assert.equal(result.status, 201); assert.equal(result.body.data.user.user_id, '9007199254740995'); assert.equal(result.body.data.user_id, '9007199254740995'); assert.equal(result.body.data.user.email, 'new@example.test'); assert.equal(result.body.data.account_type, 'email'); assert.equal(result.body.data.token, undefined);
  assert.equal(await bcrypt.compare('A-test-password-2026', value.users[1].password), true);
  assert.match(result.response.headers.get('set-cookie'), /HttpOnly/); assert.match(result.response.headers.get('set-cookie'), /Secure/); assert.match(result.response.headers.get('set-cookie'), /SameSite=Lax/);
});
test('bcrypt rejects oversized UTF-8 passwords before hashing or consuming a valid signup proof', async t => {
  const value = fixture(); const { request } = await server(t, value); await value.common.storeCode('email_register', 'new@example.test', '654321');
  const result = await request('/api/account/email/register', { email: 'new@example.test', password: '密'.repeat(30), code: '654321' });
  assert.equal(result.status, 400); assert.equal(value.values.has(value.common.codeKey('email_register', 'new@example.test')), true); assert.equal(value.users.length, 1);
});
test('password login consumes one accessible captcha proof and resolves phone identities by canonical country and national number', async t => {
  const value = fixture(); value.users[0].password = await bcrypt.hash('FixturePassword2026', 4);
  const { request } = await server(t, value); const captcha = await value.common.setCaptchaToken({ ip: '127.0.0.1' });
  let result = await request('/api/account/login/password', { account: user.email, password: 'FixturePassword2026', captcha_token: captcha, platform: 'app' });
  assert.equal(result.status, 200); assert.equal(result.body.data.user.user_id, user.id); assert.equal(result.body.data.user_id, user.id); assert.match(result.body.data.token, /^[a-f0-9]{64}$/); assert.equal(result.response.headers.get('set-cookie'), null);
  result = await request('/api/account/login/password', { account: user.email, password: 'FixturePassword2026', captcha_token: captcha, platform: 'app' }); assert.equal(result.status, 400);
  const phoneCaptcha = await value.common.setCaptchaToken({ ip: '127.0.0.1' });
  result = await request('/api/account/login/password', { account: '+12025550123', phone_country_code: '+1', password: 'FixturePassword2026', captcha_token: phoneCaptcha, platform: 'web' });
  assert.equal(result.status, 200); assert.match(result.response.headers.get('set-cookie'), /HttpOnly/);
  const lookup = value.calls.find(call => /WHERE phone/.test(call.sql)); assert.deepEqual(lookup.params, ['2025550123', '+1']);
  const wrongCaptcha = await value.common.setCaptchaToken({ ip: '127.0.0.1' });
  result = await request('/api/account/login/password', { account: user.email, password: 'DefinitelyWrongPassword', captcha_token: wrongCaptcha, platform: 'app' }); assert.equal(result.status, 401);
});
test('duplicate registration is reported without leaking driver or database details', async t => {
  const value = fixture(); const { request } = await server(t, value); await value.common.storeCode('email_register', user.email, '654321');
  const result = await request('/api/account/email/register', { email: user.email, password: 'A-test-password-2026', code: '654321' });
  assert.equal(result.status, 409); assert.equal(result.body.code, 'account_conflict'); assert.equal(JSON.stringify(result.body).includes('private database'), false);
});
test('unrelated birth profiles are opt-in and no payment routes are mounted', async t => {
  const value = fixture(); const { request } = await server(t, value);
  assert.equal((await request('/api/account/profile/birth/get')).status, 404); assert.equal((await request('/api/payment/create')).status, 404);
});
test('anonymous avatar requests are rejected before parsing or writing any uploaded file', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'account-avatar-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const value = fixture({ ACCOUNT_UPLOAD_PATH: directory }); const { base } = await server(t, value);
  const form = new FormData(); form.set('avatar', new Blob(['<svg onload="bad"></svg>'], { type: 'image/svg+xml' }), 'avatar.svg');
  const result = await fetch(`${base}/api/account/avatar`, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
  assert.equal(result.status, 401); assert.deepEqual(await readdir(directory), []);
});
test('authenticated avatars are decoded/reencoded WebP and survive on the configured persistent path', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'account-avatar-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const value = fixture({ ACCOUNT_UPLOAD_PATH: directory }); const token = await value.session(); const { base } = await server(t, value);
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#aabbcc' } }).png().toBuffer();
  const form = new FormData(); form.set('avatar', new Blob([png], { type: 'image/png' }), '../../avatar.html');
  const response = await fetch(`${base}/api/account/avatar`, { method: 'POST', headers: authenticated(token), body: form, signal: AbortSignal.timeout(5000) });
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); assert.match(data.data.avatar_url, /^\/api\/account\/avatar\/files\/[a-f0-9]{32}\.webp$/);
  const filename = data.data.avatar_url.split('/').at(-1); const stored = await readFile(path.join(directory, filename)); assert.equal((await sharp(stored).metadata()).format, 'webp');
  const download = await fetch(`${base}${data.data.avatar_url}`, { signal: AbortSignal.timeout(5000) }); assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'image/webp'); assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
});

test('password reset refuses login-purpose OTPs and changing a password revokes all old sessions', async t => {
  const value = fixture(); const token = await value.session(); const { request } = await server(t, value);
  await value.common.storeCode('email_login', user.email, '654321');
  let result = await request('/api/account/password/reset', { account: user.email, code: '654321', new_password: 'A-new-fixture-password' });
  assert.equal(result.status, 400); assert.equal(value.users[0].auth_version, 0);
  await value.common.storeCode('email_reset', user.email, '123456');
  result = await request('/api/account/password/reset', { account: user.email, code: '123456', new_password: 'A-new-fixture-password' });
  assert.equal(result.status, 200); assert.equal(value.users[0].auth_version, 1); assert.equal(await bcrypt.compare('A-new-fixture-password', value.users[0].password), true);
  assert.equal((await request('/api/account/me', {}, authenticated(token))).status, 401);
});
test('sensitive changes require fresh account proof and cannot unlink the last login method', async t => {
  const value = fixture(); const token = await value.session(); const { request } = await server(t, value);
  for (const route of ['password/change', 'email/unbind', 'phone/unbind', 'oauth/unbind', 'delete/apply']) {
    const result = await request(`/api/account/${route}`, { new_password: 'A-new-password', provider: 'google' }, authenticated(token)); assert.equal(result.status, 403, route);
  }
  value.users[0].google_sub = null; value.users[0].phone = null;
  await value.common.storeCode('email_security', user.email, '123456');
  const result = await request('/api/account/email/unbind', { code_type: 'email', code: '123456' }, authenticated(token));
  assert.equal(result.status, 409); assert.equal(result.body.code, 'last_login_method'); assert.equal(value.users[0].auth_version, 0);
});
test('phone security proof uses exactly the same E.164 target as its sender', async t => {
  const value = fixture(); const token = await value.session(); const { request } = await server(t, value);
  await value.common.storeCode('phone_security', '+12025550123', '123456');
  const result = await request('/api/account/delete/apply', { code_type: 'phone', code: '123456', reason: 'Synthetic fixture request' }, authenticated(token));
  assert.equal(result.status, 200); assert.equal(value.users[0].auth_version, 1); assert.ok(value.calls.some(call => call.sql.includes('INSERT INTO account_deletion_requests')));
});
test('OAuth state is browser-bound, provider-bound, single-use, and redirects without session tokens', async t => {
  const value = fixture({ ACCOUNT_OAUTH_ENABLED: 'true', ACCOUNT_PUBLIC_ORIGIN: 'https://shop.example.test', GOOGLE_CLIENT_ID: 'fixture-client', GOOGLE_CLIENT_SECRET: 'fixture-secret' });
  let verifiedNonce;
  value.dependencies.oauth = { async fetch(url, options) { assert.equal(url, 'https://oauth2.googleapis.com/token'); assert.equal(options.redirect, 'error'); return { ok: true, async json() { return { id_token: 'fixture-identity-token-'.repeat(4) }; } }; }, async verifyIdentity(provider, token, nonce) { assert.equal(provider, 'google'); assert.ok(token.startsWith('fixture')); verifiedNonce = nonce; return { sub: user.google_sub, nonce, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000) }; } };
  const { base } = await server(t, value);
  const response = await fetch(`${base}/api/account/google/login`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 302); const authorize = new URL(response.headers.get('location')); assert.equal(authorize.origin, 'https://accounts.google.com');
  const state = authorize.searchParams.get('state'); const cookie = `account_oauth_state=${state}`;
  assert.match(response.headers.get('set-cookie'), /HttpOnly/); assert.match(response.headers.get('set-cookie'), /Secure/);
  let callback = await fetch(`${base}/api/account/google/callback?state=${state}&code=fixture-code`, { redirect: 'manual', headers: { Cookie: 'account_oauth_state=' + 'f'.repeat(64) }, signal: AbortSignal.timeout(5000) });
  assert.equal(callback.status, 400); assert.ok(value.values.has(`account:v2:oauth:${value.common.digest(state)}`));
  callback = await fetch(`${base}/api/account/google/callback?state=${state}&code=fixture-code`, { redirect: 'manual', headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
  assert.equal(callback.status, 302); assert.equal(callback.headers.get('location'), '/account'); assert.equal(verifiedNonce, authorize.searchParams.get('nonce')); assert.match(callback.headers.get('set-cookie'), /token=[a-f0-9]{64}/);
  callback = await fetch(`${base}/api/account/google/callback?state=${state}&code=fixture-code`, { redirect: 'manual', headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
  assert.equal(callback.status, 400);
});
test('OAuth rejects non-finite expiry, stale native tokens, invalid nonce and cross-provider state', async t => {
  const value = fixture({ ACCOUNT_OAUTH_ENABLED: 'true', ACCOUNT_PUBLIC_ORIGIN: 'https://shop.example.test', GOOGLE_CLIENT_ID: 'fixture-client', GOOGLE_CLIENT_SECRET: 'fixture-secret', APPLE_CLIENT_ID: 'fixture-apple', APPLE_CLIENT_SECRET: 'fixture-apple-secret' });
  let payload;
  value.dependencies.oauth = { async verifyIdentity() { return payload; }, async fetch() { return { ok: true, async json() { return { id_token: 'fixture-identity-'.repeat(4) }; } }; } };
  const { request, base } = await server(t, value); const now = Math.floor(Date.now() / 1000);
  for (const exp of [undefined, 'invalid', Infinity]) { payload = { sub: user.google_sub, exp, iat: now }; assert.equal((await request('/api/account/google/app', { idToken: 'f'.repeat(64), platform: 'app' })).status, 401); }
  payload = { sub: user.google_sub, exp: now + 600, iat: now - 1000 }; assert.equal((await request('/api/account/google/app', { idToken: 'f'.repeat(64), platform: 'app' })).status, 401);
  const start = await fetch(`${base}/api/account/google/login`, { redirect: 'manual', signal: AbortSignal.timeout(5000) }); const state = new URL(start.headers.get('location')).searchParams.get('state');
  payload = { sub: user.google_sub, exp: now + 600, iat: now, nonce: 'incorrect-fixture-nonce' };
  const callback = await fetch(`${base}/api/account/google/callback?state=${state}&code=fixture`, { redirect: 'manual', headers: { Cookie: `account_oauth_state=${state}` }, signal: AbortSignal.timeout(5000) });
  assert.equal(callback.status, 401); assert.equal([...value.values.keys()].some(key => key.startsWith('account:v2:session:')), false);
  const secondStart = await fetch(`${base}/api/account/google/login`, { redirect: 'manual', signal: AbortSignal.timeout(5000) }); const secondState = new URL(secondStart.headers.get('location')).searchParams.get('state');
  assert.equal((await request('/api/account/apple/callback', { state: secondState, code: 'fixture' }, { Cookie: `account_oauth_state=${secondState}`, Origin: 'https://appleid.apple.com' })).status, 400);
});

test('invalid avatar content and storage quotas do not produce usable files or change profile data', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'account-avatar-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const value = fixture({ ACCOUNT_UPLOAD_PATH: directory, ACCOUNT_AVATAR_MAX_BYTES: '1' }); const token = await value.session(); const { base } = await server(t, value);
  for (const bytes of [Buffer.from('<svg onload="bad"/>'), await sharp({ create: { width: 24, height: 24, channels: 3, background: '#abc' } }).png().toBuffer()]) {
    const form = new FormData(); form.set('avatar', new Blob([bytes], { type: 'image/png' }), 'image.png');
    const result = await fetch(`${base}/api/account/avatar`, { method: 'POST', headers: authenticated(token), body: form, signal: AbortSignal.timeout(5000) }); assert.ok([400, 503].includes(result.status));
  }
  assert.deepEqual(await readdir(directory), []); assert.equal(value.users[0].avatar_url, null);
});
