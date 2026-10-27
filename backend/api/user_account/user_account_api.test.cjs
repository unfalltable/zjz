'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const canonical = require('../account/api_server.cjs');
const { readConfig } = require('../account/common/common.cjs');

test('legacy import and launch paths export the exact canonical module without a second implementation', () => {
  assert.strictEqual(require('./user_account_api.js'), canonical);
  assert.strictEqual(require('./server.cjs'), canonical);
  assert.equal(typeof canonical.createAccountApp, 'function'); assert.equal(typeof canonical.start, 'function');
  for (const filename of ['user_account_api.js', 'server.cjs']) {
    const source = readFileSync(path.join(__dirname, filename), 'utf8');
    assert.ok(source.length < 1000); assert.doesNotMatch(source, /createPool|createClient|\.listen\(|GOOGLE_CLIENT_SECRET|app\.post/);
  }
});

test('canonical factory exposes all supplied account endpoints and keeps existing me/logout paths', () => {
  const forbidden = () => { throw new Error('Factory import must not connect to a database or send messages.'); };
  const app = canonical.createAccountApp({ config: readConfig({ NODE_ENV: 'test' }), dbPool: { execute: forbidden }, redisClient: { get: forbidden }, delivery: { capabilities: { email: false, sms: false } } });
  const actual = new Set();
  function collect(stack) { for (const layer of stack || []) { if (layer.route) for (const [method, enabled] of Object.entries(layer.route.methods)) if (enabled) actual.add(`${method.toUpperCase()} ${layer.route.path}`); if (layer.handle?.stack) collect(layer.handle.stack); } }
  collect(app.router.stack);
  const expected = [
    'GET /health', 'GET /api/account/config', 'GET /api/account/google/login', 'GET /api/account/google/callback', 'POST /api/account/google/app',
    'GET /api/account/apple/login', 'POST /api/account/apple/callback', 'POST /api/account/apple/app',
    ...['captcha/image', 'captcha/image/verify', 'captcha/slider', 'captcha/slider/verify', 'email/send-code', 'phone/send-code', 'email/login/send-code', 'phone/login/send-code', 'backup-email/send-code',
      'email/register', 'phone/register', 'login/password', 'login/email/code', 'login/phone/code', 'me', 'nickname', 'avatar', 'restrictions', 'token/check', 'token/refresh', 'logout',
      'backup-email/bind', 'backup-email/delete', 'password/change', 'password/reset', 'email/bind', 'phone/bind', 'email/unbind', 'phone/unbind', 'oauth/bind', 'oauth/unbind', 'delete/apply', 'profile/birth/get', 'profile/birth/save'].map(route => `POST /api/account/${route}`),
  ];
  for (const route of expected) assert.ok(actual.has(route), route);
  for (const route of actual) assert.equal(/payment|liuyao|qimen/.test(route), false, route);
});

test('old delivery helper paths delegate to canonical providers and never simulate delivery', async () => {
  const email = require('./email_code.js'); const sms = require('./phone_code.js');
  assert.equal(typeof email.sendEmailCode, 'function'); assert.equal(typeof sms.sendSms, 'function');
  const saved = {};
  for (const key of ['ACCOUNT_SMTP_HOST', 'ACCOUNT_SMTP_USER', 'ACCOUNT_SMTP_PASSWORD', 'ACCOUNT_EMAIL_FROM', 'ACCOUNT_SMS_PROVIDER']) { saved[key] = process.env[key]; delete process.env[key]; }
  try { await assert.rejects(email.sendEmailCode('fixture@example.test', '123456')); await assert.rejects(sms.sendSms('+1', '2025550123', '123456')); }
  finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
