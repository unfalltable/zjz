'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const express = require('express');
const { createCaptchaRouter, consumeSlider, verifyScript } = require('../captcha/captcha_api.cjs');
const { createSenderRouter } = require('../sender/send_code_api.cjs');
const { createDelivery } = require('../sender/sender.cjs');
const { normalizeEmail, normalizePhone, phoneParts } = require('../common/common.cjs');

function fixture() {
  const values = new Map(), calls = [], stored = [], consumed = new Set();
  const common = {
    config: { env: {} },
    redisClient: {
      async set(key, value, options) { calls.push({ operation: 'set', key, options }); if (options?.NX && values.has(key)) return null; values.set(key, value); return 'OK'; },
      async del(key) { calls.push({ operation: 'del', key }); return values.delete(key) ? 1 : 0; },
      async eval(script, { keys, arguments: arguments_ }) {
        assert.equal(script, verifyScript, 'captcha verification must use its single atomic comparison script');
        calls.push({ operation: 'eval', key: keys[0] });
        const raw = values.get(keys[0]); if (!raw) return 0;
        const record = JSON.parse(raw); if (record.ipHash !== arguments_[0]) return 0;
        const matches = arguments_[2] === 'slider' ? Math.abs(Number(arguments_[1]) - record.answer) <= 5 : arguments_[1] === record.answer;
        if (matches) { values.delete(keys[0]); return 1; }
        if (++record.attempts >= 5) values.delete(keys[0]); else values.set(keys[0], JSON.stringify(record));
        return 0;
      },
    },
    dbPool: { async execute() { return [[]]; } },
    normalizeEmail, normalizePhone, phoneParts,
    async checkIpRateLimit() { return true; },
    async setCaptchaToken() { return 'c'.repeat(64); },
    async consumeCaptchaToken(_request, token) { if (typeof token !== 'string' || consumed.has(token)) return false; consumed.add(token); return token.startsWith('fixture-captcha-'); },
    async requireSession() { return { user: { email: 'owner@example.test', phone: '2025550123', phone_country_code: '+1', backup_email: 'backup@example.test' } }; },
    async getSession() { return { user_id: '1' }; },
    codeKey(kind, target) { return `account:v2:otp:${kind}:${crypto.createHash('sha256').update(target).digest('hex')}`; },
    async storeCode(kind, target, code, ttl) { stored.push({ kind, target, code, ttl }); values.set(this.codeKey(kind, target), JSON.stringify({ hash: crypto.createHash('sha256').update(code).digest('hex'), attempts: 0 })); },
    fail(status, code, message) { const error = new Error(message); error.status = status; error.code = code; throw error; },
    route(handler) { return async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } }; },
  };
  return { common, values, calls, stored };
}
async function server(t, router) {
  const app = express(); app.use(express.json({ limit: '32kb' }));
  app.use((req, _res, next) => { Object.defineProperty(req, 'ip', { value: req.headers['x-fixture-ip'] || '127.0.0.1' }); next(); });
  app.use(router);
  app.use((error, _req, res, _next) => res.status(error.status || 503).json({ success: false, code: error.code || 'unavailable', message: error.message }));
  const listener = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  t.after(async () => { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); });
  return async (path, body = {}, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${listener.address().port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    return { status: response.status, json: await response.json() };
  };
}
const syntheticCaptcha = { create() { return { text: 'ABCD', data: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><rect width="160" height="60" fill="#eee"/></svg>' }; } };

test('synthetic captcha is PNG with no answer and is consumed exactly once even concurrently', async t => {
  const { common, values, calls } = fixture();
  const request = await server(t, createCaptchaRouter(common, { svgCaptcha: syntheticCaptcha }));
  const generated = await request('/api/account/captcha/image');
  assert.equal(generated.status, 200); assert.match(generated.json.data.image, /^data:image\/png;base64,/);
  assert.equal(generated.json.data.answer, undefined); assert.equal(generated.json.data.code, undefined);
  const id = generated.json.data.captcha_id;
  const responses = await Promise.all([request('/api/account/captcha/image/verify', { captcha_id: id, code: 'ABCD' }), request('/api/account/captcha/image/verify', { captcha_id: id, code: 'ABCD' })]);
  assert.deepEqual(responses.map(item => item.status).sort(), [200, 400]);
  assert.equal(values.has(`account:v2:captcha:image:${id}`), false);
  assert.equal(calls.filter(item => item.operation === 'eval').length, 2);
});

test('captcha wrong-IP attempts do not steal it and five wrong answers invalidate it', async t => {
  const { common, values } = fixture();
  const request = await server(t, createCaptchaRouter(common, { svgCaptcha: syntheticCaptcha }));
  let response = await request('/api/account/captcha/image'); const id = response.json.data.captcha_id;
  response = await request('/api/account/captcha/image/verify', { captcha_id: id, code: 'ABCD' }, { 'x-fixture-ip': '192.0.2.50' });
  assert.equal(response.status, 400); assert.ok(values.has(`account:v2:captcha:image:${id}`));
  for (let index = 0; index < 5; index++) assert.equal((await request('/api/account/captcha/image/verify', { captcha_id: id, code: 'ZZZZ' })).status, 400);
  assert.equal(values.has(`account:v2:captcha:image:${id}`), false);
  assert.equal((await request('/api/account/captcha/image/verify', { captcha_id: id, code: 'ABCD' })).status, 400);
});

test('slider compatibility rejects non-finite, empty, negative or structurally invalid coordinates', async () => {
  const { common, values } = fixture(); const id = 'a'.repeat(32), req = { ip: '127.0.0.1' };
  values.set(`account:v2:captcha:slider:${id}`, JSON.stringify({ answer: 100, attempts: 0, ipHash: crypto.createHash('sha256').update(req.ip).digest('hex') }));
  for (const input of [NaN, Infinity, -1, '', ' ', null, {}, [], '100junk', 'Infinity', 300]) assert.equal(await consumeSlider(common, req, id, input), false);
  assert.equal(await consumeSlider(common, req, id, '100'), true);
  assert.equal(await consumeSlider(common, req, id, 100), false);
});

test('missing provider configuration never consumes captcha, sends, stores or returns a code', async t => {
  const { common, calls, stored } = fixture();
  const request = await server(t, createSenderRouter(common));
  for (const path of ['/api/account/email/send-code', '/api/account/phone/send-code']) {
    const result = await request(path, { email: 'a@example.test', phone: '+15555550123', captcha_token: 'fixture-captcha-a' });
    assert.equal(result.status, 503); assert.equal(result.json.success, false); assert.equal(result.json.data, undefined);
  }
  assert.equal(calls.length, 0); assert.equal(stored.length, 0);
});

test('provider failure leaves no new or old usable OTP, and cooldown prevents parallel sends', async t => {
  const { common, values, stored } = fixture(); let attempts = 0;
  const key = common.codeKey('email_register', 'buyer@example.test'); values.set(key, 'old-code');
  const request = await server(t, createSenderRouter(common, { capabilities: { email: true, sms: false }, async sendEmailCode() { attempts++; throw new Error('mock provider failure'); } }));
  const first = await request('/api/account/email/send-code', { email: 'buyer@example.test', captcha_token: 'fixture-captcha-a' });
  assert.equal(first.status, 503); assert.equal(values.has(key), false); assert.equal(stored.length, 0);
  const retry = await request('/api/account/email/send-code', { email: 'buyer@example.test', captcha_token: 'fixture-captcha-b' });
  assert.equal(retry.status, 429); assert.equal(attempts, 1);
});

test('sender acceptance precedes storage, normalizes the recipient and never exposes OTP', async t => {
  const { common, stored } = fixture(); let accepted = false;
  const store = common.storeCode.bind(common); common.storeCode = async (...args) => { assert.equal(accepted, true); await store(...args); };
  const request = await server(t, createSenderRouter(common, { capabilities: { email: true, sms: false }, async sendEmailCode(target, code) { assert.equal(target, 'buyer@example.test'); assert.match(code, /^\d{6}$/); accepted = true; } }));
  const result = await request('/api/account/email/send-code', { email: ' Buyer@Example.Test ', captcha_token: 'fixture-captcha-a' });
  assert.equal(result.status, 200); assert.equal(stored.length, 1); assert.equal(stored[0].kind, 'email_register');
  assert.equal(JSON.stringify(result.json).includes(stored[0].code), false); assert.deepEqual(result.json.data, { expires_in: 300, retry_after: 60 });
});

test('login and reset codes are purpose-separated and ineligible accounts get indistinguishable responses', async t => {
  const { common, stored } = fixture(); let sends = 0;
  common.dbPool.execute = async () => [[{ id: '1', status: 1 }]];
  const request = await server(t, createSenderRouter(common, { capabilities: { email: true, sms: false }, async sendEmailCode() { sends++; } }));
  const result = await request('/api/account/email/login/send-code', { email: 'reset@example.test', captcha_token: 'fixture-captcha-a', purpose: 'reset' });
  assert.equal(result.status, 200); assert.equal(stored[0].kind, 'email_reset'); assert.equal(sends, 1);
  common.dbPool.execute = async () => [[]];
  const missing = await request('/api/account/email/login/send-code', { email: 'missing@example.test', captcha_token: 'fixture-captcha-b', purpose: 'login' });
  assert.equal(missing.status, 200); assert.deepEqual(missing.json, result.json); assert.equal(sends, 1);
});

test('security codes target only the signed-in account contact and require a live session', async t => {
  const { common, stored } = fixture(); const delivered = [];
  const request = await server(t, createSenderRouter(common, { capabilities: { email: true, sms: false }, async sendEmailCode(target) { delivered.push(target); } }));
  const result = await request('/api/account/email/login/send-code', { email: 'attacker@example.test', captcha_token: 'fixture-captcha-a', purpose: 'security' });
  assert.equal(result.status, 200); assert.deepEqual(delivered, ['owner@example.test']); assert.equal(stored[0].kind, 'email_security');
  common.requireSession = async () => common.fail(401, 'authentication_required', 'Sign in.');
  const unauthenticated = await request('/api/account/backup-email/send-code', { email: 'attacker@example.test', captcha_token: 'fixture-captcha-b', purpose: 'security' });
  assert.equal(unauthenticated.status, 401); assert.equal(delivered.length, 1);
});

test('SMTP requires TLS and an actually accepted recipient; credentials and OTP never enter errors', async () => {
  const env = { ACCOUNT_SMTP_HOST: 'smtp.example.test', ACCOUNT_SMTP_USER: 'fixture-user', ACCOUNT_SMTP_PASSWORD: 'fixture-password', ACCOUNT_EMAIL_FROM: 'store@example.test' };
  let options;
  const delivery = createDelivery({ env }, { createTransport(value) { options = value; return { async sendMail() { return { accepted: ['buyer@example.test'] }; } }; } });
  assert.equal(delivery.capabilities.email, true); await delivery.sendEmailCode('buyer@example.test', '123456');
  assert.equal(options.requireTLS, true); assert.equal(options.tls.minVersion, 'TLSv1.2'); assert.equal(options.logger, false); assert.equal(options.debug, false);
  const rejected = createDelivery({ env }, { createTransport() { return { async sendMail() { return { accepted: [], rejected: ['buyer@example.test'] }; } }; } });
  await assert.rejects(rejected.sendEmailCode('buyer@example.test', '123456'), error => error.status === 503 && !/123456|fixture-password|buyer@/.test(error.message));
});

test('Twilio uses a fixed endpoint with no redirects and validates provider acceptance', async () => {
  const env = { ACCOUNT_SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'b'.repeat(32), TWILIO_FROM_NUMBER: '+15555550111' };
  let sent;
  const delivery = createDelivery({ env }, { async fetch(url, options) { sent = { url, options }; return { ok: true, async json() { return { sid: `SM${'c'.repeat(32)}`, status: 'queued', error_code: null }; } }; } });
  assert.equal(delivery.capabilities.sms, true); await delivery.sendSms('+15555550123', '123456');
  assert.equal(sent.url, `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`); assert.equal(sent.options.redirect, 'error'); assert.equal(sent.options.body.get('To'), '+15555550123');
  const failedDelivery = createDelivery({ env }, { async fetch() { return { ok: false, async json() { return { sid: `SM${'c'.repeat(32)}`, status: 'failed' }; } }; } });
  await assert.rejects(failedDelivery.sendSms('+15555550123', '123456'), error => error.status === 503 && !error.message.includes('123456'));
});

test('configured SMS factory works through the real router and keeps country-aware SQL separate from E.164 delivery', async t => {
  const { common, stored } = fixture(); const queries = [], destinations = [];
  common.dbPool.execute = async (sql, parameters) => { queries.push({ sql, parameters }); return sql.includes('account_restrictions') ? [[]] : [[{ id: '1', status: 1 }]]; };
  const env = { ACCOUNT_SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'b'.repeat(32), TWILIO_FROM_NUMBER: '+12025550111' };
  const delivery = createDelivery({ env }, { async fetch(_url, options) { destinations.push(options.body.get('To')); return { ok: true, async json() { return { sid: `SM${'c'.repeat(32)}`, status: 'queued', error_code: null }; } }; } });
  const request = await server(t, createSenderRouter(common, delivery));
  const result = await request('/api/account/phone/login/send-code', { phone: '2025550123', phone_country_code: '+1', purpose: 'reset', captcha_token: 'fixture-captcha-a' });
  assert.equal(result.status, 200, JSON.stringify(result.json)); assert.deepEqual(destinations, ['+12025550123']);
  assert.match(queries[0].sql, /phone = \? AND phone_country_code = \?/); assert.deepEqual(queries[0].parameters, ['2025550123', '+1']);
  assert.equal(stored[0].target, '+12025550123'); assert.equal(stored[0].kind, 'phone_reset');
});

test('blocked accounts cannot receive a fresh login OTP but retain the same public response', async t => {
  const { common, stored } = fixture(); let sends = 0;
  common.dbPool.execute = async sql => sql.includes('account_restrictions') ? [[{ restriction_type: 'login' }]] : [[{ id: '1', status: 1 }]];
  const request = await server(t, createSenderRouter(common, { capabilities: { email: true, sms: false }, async sendEmailCode() { sends++; } }));
  const result = await request('/api/account/email/login/send-code', { email: 'blocked@example.test', captcha_token: 'fixture-captcha-a' });
  assert.equal(result.status, 200); assert.equal(result.json.success, true); assert.equal(stored.length, 0); assert.equal(sends, 0);
});
