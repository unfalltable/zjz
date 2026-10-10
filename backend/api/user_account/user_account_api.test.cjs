const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SESSION_TTL = 30 * 24 * 60 * 60;
const API_FILE = path.join(__dirname, 'user_account_api.js');

// Run the supplied CommonJS module without loading dependencies or opening sockets.
// Source logging is deliberately suppressed: account handlers log sensitive data.
function loadAccountApi(overrides = {}) {
    const routes = new Map();
    const sqlCalls = [];
    const hashCalls = [];
    const compareCalls = [];
    const redisCalls = [];
    const oauthCalls = [];
    const config = {};
    const memory = new Map(Object.entries(overrides.redisData || {}));
    const app = {
        use() {},
        set() {},
        get(route, handler) { routes.set(`GET ${route}`, handler); },
        post(route, handler) { routes.set(`POST ${route}`, handler); },
        listen() { throw new Error('Tests must never open a listener'); },
    };
    const db = {
        async execute(sql, params) {
            sqlCalls.push({ sql, params: Array.from(params || []) });
            return [overrides.sql ? await overrides.sql(sql, params) : []];
        },
    };
    const redis = {
        on() {},
        async connect() {},
        async incr(key) {
            redisCalls.push({ method: 'incr', key });
            const count = overrides.rateCount ?? Number(memory.get(key) || 0) + 1;
            memory.set(key, String(count));
            return count;
        },
        async expire(key, seconds) {
            redisCalls.push({ method: 'expire', key, seconds });
            return memory.has(key) ? 1 : 0;
        },
        async get(key) {
            redisCalls.push({ method: 'get', key });
            return memory.get(key) ?? null;
        },
        async set(key, value, options) {
            redisCalls.push({ method: 'set', key, value, options });
            memory.set(key, value);
            return 'OK';
        },
        async del(key) {
            redisCalls.push({ method: 'del', key });
            return memory.delete(key) ? 1 : 0;
        },
    };
    const googlePayload = overrides.googlePayload || {
        sub: 'google-test-user', email: 'oauth@example.test',
        email_verified: true, name: 'Example User', picture: null,
    };
    class OAuth2Client {
        constructor(clientId, clientSecret, redirectUri) {
            config.google = { clientId, clientSecret, redirectUri };
        }
        generateAuthUrl(options) {
            oauthCalls.push({ method: 'google-url', options });
            return 'https://accounts.example.test/authorize';
        }
        async getToken() {
            oauthCalls.push({ method: 'google-exchange' });
            return { tokens: { id_token: 'test-only-google-identity' } };
        }
        async verifyIdToken() {
            oauthCalls.push({ method: 'google-verify' });
            if (overrides.googleError) throw new Error('Test-only verification failure');
            return { getPayload: () => googlePayload };
        }
    }
    const express = () => app;
    express.urlencoded = express.json = () => function middleware() {};
    const dependencies = {
        express,
        'cookie-parser': () => function cookieMiddleware() {},
        'mysql2/promise': { createPool: options => { config.mysql = options; return db; } },
        redis: { createClient: options => { config.redis = options; return redis; } },
        bcrypt: {
            async hash(value, rounds) {
                hashCalls.push({ value, rounds });
                return 'test-only-bcrypt-hash';
            },
            async compare(value, hash) {
                compareCalls.push({ value, hash });
                return overrides.passwordMatch ?? true;
            },
        },
        crypto: {
            randomBytes: size => Buffer.alloc(size, 7),
            randomInt: () => 123456,
        },
        'google-auth-library': { OAuth2Client },
        'apple-signin-auth': {
            getAuthorizationUrl: () => 'https://apple.example.test/authorize',
            async getAuthorizationToken() {
                oauthCalls.push({ method: 'apple-exchange' });
                return { id_token: 'test-only-apple-identity' };
            },
            async verifyIdToken() {
                oauthCalls.push({ method: 'apple-verify' });
                return overrides.applePayload || {
                    sub: 'apple-test-user', email: 'apple@example.test',
                };
            },
        },
        'svg-captcha': { create: () => ({ text: 'aBcD', data: '<svg></svg>' }) },
        sharp: () => { throw new Error('Image processing is not exercised by this isolated suite'); },
    };
    const context = vm.createContext({
        require(name) {
            assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency in account module');
            return dependencies[name];
        },
        module: { exports: {} },
        process: { env: {
            NODE_ENV: 'production',
            MYSQL_HOST: 'db.example.test', MYSQL_PORT: '3307', MYSQL_USER: 'test-user',
            MYSQL_PASSWORD: 'test-only-db-password', MYSQL_DATABASE: 'test-db',
            REDIS_URL: 'redis://cache.example.test:6380',
            GOOGLE_CLIENT_ID: 'test-only-google-client', GOOGLE_CLIENT_SECRET: 'test-only-google-secret',
            GOOGLE_REDIRECT_URI: 'https://shop.example.test/api/account/google/callback',
            APPLE_CLIENT_ID: 'test-only-apple-client', APPLE_CLIENT_SECRET: 'test-only-apple-secret',
            APPLE_REDIRECT_URI: 'https://shop.example.test/api/account/apple/callback',
        } },
        Buffer,
        console: { log() {}, error() {}, warn() {}, info() {} },
    });
    new vm.Script(readFileSync(API_FILE, 'utf8'), { filename: API_FILE })
        .runInContext(context, { timeout: 1000 });

    async function invoke(method, route, { body = {}, query = {} } = {}) {
        const handler = routes.get(`${method} ${route}`);
        assert.equal(typeof handler, 'function', 'Requested account route must be registered');
        const response = {
            statusCode: 200,
            cookies: [],
            status(code) { this.statusCode = code; return this; },
            json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; },
            cookie(name, value, options) {
                this.cookies.push({ name, value, options: JSON.parse(JSON.stringify(options)) });
                return this;
            },
            redirect(url) { this.redirectUrl = url; return this; },
        };
        await handler({ body, query, ip: '192.0.2.10', cookies: {}, headers: {} }, response);
        return response;
    }
    return { routes, invoke, memory, sqlCalls, hashCalls, compareCalls, redisCalls, oauthCalls, config };
}

function findSession(harness) {
    const session = harness.redisCalls.find(call => call.method === 'set' && call.key.startsWith('session:'));
    assert.ok(session, 'Successful authentication must save a Redis session');
    assert.equal(session.options.EX, SESSION_TTL);
    return JSON.parse(session.value);
}

function assertWebLogin(response) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(Object.hasOwn(response.body.data, 'token'), false);
    assert.equal(response.cookies.length, 1);
    const cookie = response.cookies[0];
    assert.equal(cookie.name, 'token');
    assert.equal(typeof cookie.value, 'string');
    assert.deepEqual(cookie.options, {
        httpOnly: true, secure: true, sameSite: 'lax', maxAge: SESSION_TTL * 1000, path: '/',
    });
}

function assertAppLogin(response) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(typeof response.body.data.token, 'string');
    assert.equal(response.body.data.token.length, 64);
    assert.equal(response.body.data.expires_in, SESSION_TTL);
    assert.equal(response.cookies.length, 0);
}

test('registers all 22 supplied account routes without opening a listener', () => {
    const { routes } = loadAccountApi();
    assert.deepEqual([...routes.keys()].sort(), [
        'GET /api/account/google/login', 'GET /api/account/google/callback',
        'POST /api/account/google/app', 'GET /api/account/apple/login',
        'POST /api/account/apple/callback', 'POST /api/account/apple/app',
        'POST /api/account/captcha/image', 'POST /api/account/captcha/image/verify',
        'POST /api/account/captcha/slider', 'POST /api/account/captcha/slider/verify',
        'POST /api/account/email/send-code', 'POST /api/account/email/register',
        'POST /api/account/phone/send-code', 'POST /api/account/phone/register',
        'POST /api/account/login/password', 'POST /api/account/email/login/send-code',
        'POST /api/account/login/email/code', 'POST /api/account/phone/login/send-code',
        'POST /api/account/login/phone/code', 'POST /api/account/token/check',
        'POST /api/account/token/refresh', 'POST /api/account/logout',
    ].sort());
});

test('MySQL, Redis and Google configuration comes from isolated environment values', () => {
    const { config } = loadAccountApi();
    assert.equal(config.mysql.host, 'db.example.test');
    assert.equal(Number(config.mysql.port), 3307);
    assert.equal(config.mysql.user, 'test-user');
    assert.equal(config.mysql.password === 'test-only-db-password', true);
    assert.equal(config.mysql.database, 'test-db');
    assert.equal(config.redis.url, 'redis://cache.example.test:6380');
    assert.equal(config.google.clientId, 'test-only-google-client');
    assert.equal(config.google.clientSecret === 'test-only-google-secret', true);
    assert.equal(config.google.redirectUri, 'https://shop.example.test/api/account/google/callback');
});

const missingParameterCases = [
    ['GET', 'google/callback', {}, 400],
    ['POST', 'google/app', {}, 400],
    ['POST', 'apple/callback', {}, 400],
    ['POST', 'apple/app', {}, 400],
    ['POST', 'captcha/image/verify', {}, 400],
    ['POST', 'captcha/image/verify', { captcha_id: 'test-id' }, 400],
    ['POST', 'captcha/slider/verify', {}, 400],
    ['POST', 'captcha/slider/verify', { captcha_id: 'test-id' }, 400],
    ['POST', 'email/send-code', {}, 400],
    ['POST', 'email/send-code', { email: 'user@example.test' }, 400],
    ['POST', 'email/register', {}, 400],
    ['POST', 'email/register', { email: 'user@example.test' }, 400],
    ['POST', 'email/register', { email: 'user@example.test', code: '123456' }, 400],
    ['POST', 'phone/send-code', {}, 400],
    ['POST', 'phone/send-code', { phone: '2025550100' }, 400],
    ['POST', 'phone/register', {}, 400],
    ['POST', 'phone/register', { phone: '2025550100' }, 400],
    ['POST', 'phone/register', { phone: '2025550100', code: '123456' }, 400],
    ['POST', 'login/password', {}, 400],
    ['POST', 'login/password', { account: 'user@example.test' }, 400],
    ['POST', 'login/password', { account: 'user@example.test', password: 'test-only-password' }, 400],
    ['POST', 'login/password', { account: 'user@example.test', password: 'test-only-password', captcha_id: 'test-id' }, 400],
    ['POST', 'login/password', { account: 'user@example.test', password: 'test-only-password', captcha_id: 'test-id', x: 0 }, 400],
    ['POST', 'email/login/send-code', {}, 400],
    ['POST', 'email/login/send-code', { email: 'user@example.test' }, 400],
    ['POST', 'login/email/code', {}, 400],
    ['POST', 'login/email/code', { platform: 'web' }, 400],
    ['POST', 'login/email/code', { platform: 'web', email: 'user@example.test' }, 400],
    ['POST', 'login/phone/code', {}, 400],
    ['POST', 'login/phone/code', { platform: 'app' }, 400],
    ['POST', 'login/phone/code', { platform: 'app', phone: '2025550100' }, 400],
    ['POST', 'phone/login/send-code', {}, 400],
    ['POST', 'phone/login/send-code', { phone: '2025550100' }, 400],
    ['POST', 'token/check', {}, 401],
    ['POST', 'token/refresh', {}, 401],
    ['POST', 'logout', {}, 400],
];

for (const [index, [method, route, body, expectedStatus]] of missingParameterCases.entries()) {
    test(`rejects missing account parameters: ${method} ${route} case ${index + 1}`, async () => {
        const harness = loadAccountApi();
        const response = await harness.invoke(method, `/api/account/${route}`, { body });
        assert.equal(response.statusCode, expectedStatus);
        assert.equal(response.body.success, false);
        assert.equal(harness.sqlCalls.length, 0);
        assert.equal(harness.hashCalls.length, 0);
        assert.equal(harness.compareCalls.length, 0);
        assert.equal(harness.oauthCalls.length, 0);
    });
}

for (const [route, expectedStatus] of [['captcha/image', 429], ['captcha/slider', 429], ['email/send-code', 429], ['phone/send-code', 429]]) {
    test(`enforces Redis-backed IP rate limit for ${route}`, async () => {
        const harness = loadAccountApi({ rateCount: 21 });
        const response = await harness.invoke('POST', `/api/account/${route}`);
        assert.equal(response.statusCode, expectedStatus);
        assert.equal(response.body.success, false);
        assert.equal(harness.redisCalls.filter(call => call.method === 'set').length, 0);
    });
}

for (const accountType of ['email', 'phone']) {
    test(`${accountType} registration hashes password, inserts MySQL user and consumes verification code`, async () => {
        const account = accountType === 'email' ? 'user@example.test' : '2025550100';
        const codeKey = `${accountType}_register_code:${account}`;
        const harness = loadAccountApi({ redisData: { [codeKey]: '123456' } });
        const body = { [accountType]: ` ${accountType === 'email' ? account.toUpperCase() : account} `,
            code: ' 123456 ', password: 'test-only-password',
            country: 'US', phone_country: 'US', phone_country_code: '+1' };
        const response = await harness.invoke('POST', `/api/account/${accountType}/register`, { body });
        assertAppLogin(response);
        assert.equal(response.body.data.account, account);
        assert.equal(harness.hashCalls.length, 1);
        assert.equal(harness.hashCalls[0].rounds, 12);
        const insert = harness.sqlCalls.find(call => /INSERT INTO users/.test(call.sql));
        assert.ok(insert);
        assert.equal(insert.params.includes('test-only-bcrypt-hash'), true);
        assert.equal(insert.params.includes(body.password), false);
        assert.equal(insert.params.includes(account), true);
        assert.equal(harness.memory.has(codeKey), false);
        assert.equal(findSession(harness).user_id, response.body.data.user_id);
    });

    test(`${accountType} registration refuses duplicate accounts before hashing`, async () => {
        const harness = loadAccountApi({ sql: () => [{ id: 42 }] });
        const response = await harness.invoke('POST', `/api/account/${accountType}/register`, {
            body: { [accountType]: accountType === 'email' ? 'user@example.test' : '2025550100',
                code: '123456', password: 'test-only-password' },
        });
        assert.equal(response.statusCode, 409);
        assert.equal(harness.hashCalls.length, 0);
        assert.equal(harness.sqlCalls.some(call => /INSERT/.test(call.sql)), false);
    });
}

for (const platform of ['web', 'app']) {
    for (const accountType of ['email', 'phone']) {
        test(`password login: ${accountType} account / ${platform} response contract`, async () => {
            const account = accountType === 'email' ? 'user@example.test' : '2025550100';
            const harness = loadAccountApi({
                redisData: { 'captcha_slider:test-id': JSON.stringify({ x: 100 }) },
                sql: sql => /SELECT/.test(sql) ? [{ id: 42, password: 'test-only-bcrypt-hash', status: 1 }] : [],
            });
            const response = await harness.invoke('POST', '/api/account/login/password', {
                body: { account: ` ${accountType === 'email' ? account.toUpperCase() : account} `,
                    password: 'test-only-password', captcha_id: 'test-id', x: 104, platform },
            });
            platform === 'web' ? assertWebLogin(response) : assertAppLogin(response);
            assert.equal(response.body.data.user_id, 42);
            assert.equal(response.body.data.account_type, accountType);
            assert.equal(harness.compareCalls.length, 1);
            assert.equal(harness.sqlCalls[0].params[0], account);
            assert.equal(harness.sqlCalls.some(call => /UPDATE users/.test(call.sql)), true);
            assert.equal(harness.memory.has('captcha_slider:test-id'), false);
            const session = findSession(harness);
            assert.equal(session.login_type, 'password');
            assert.equal(session.platform, platform);
        });
    }
}

for (const [label, rows, passwordMatch, status] of [
    ['unknown account', [], true, 401],
    ['disabled account', [{ id: 42, status: 0 }], true, 403],
    ['incorrect password', [{ id: 42, status: 1, password: 'test-only-bcrypt-hash' }], false, 401],
]) {
    test(`password login refuses ${label} without creating a session`, async () => {
        const harness = loadAccountApi({ passwordMatch,
            redisData: { 'captcha_slider:test-id': JSON.stringify({ x: 100 }) }, sql: () => rows });
        const response = await harness.invoke('POST', '/api/account/login/password', {
            body: { account: 'user@example.test', password: 'test-only-password', captcha_id: 'test-id', x: 100, platform: 'app' },
        });
        assert.equal(response.statusCode, status);
        assert.equal(response.body.success, false);
        assert.equal(harness.redisCalls.some(call => call.method === 'set'), false);
        assert.equal(harness.sqlCalls.some(call => /UPDATE/.test(call.sql)), false);
    });
}

for (const route of ['captcha/slider/verify', 'login/password', 'login/email/code', 'login/phone/code']) {
    for (const x of ['abc', 'NaN']) {
        test(`rejects non-finite slider position for ${route} (${x})`, async () => {
            const harness = loadAccountApi({ redisData: { 'captcha_slider:test-id': JSON.stringify({ x: 100 }) } });
            const response = await harness.invoke('POST', `/api/account/${route}`, {
                body: { account: 'user@example.test', email: 'user@example.test', phone: '2025550100',
                    password: 'test-only-password', code: '123456', captcha_id: 'test-id', x, platform: 'app' },
            });
            assert.equal(response.statusCode, 400);
            assert.equal(response.body.success, false);
            assert.equal(harness.memory.has('captcha_slider:test-id'), true);
            assert.equal(harness.sqlCalls.length, 0);
            assert.equal(harness.redisCalls.some(call => call.method === 'set'), false);
        });
    }
}

for (const accountType of ['email', 'phone']) {
    for (const platform of ['web', 'app']) {
        test(`verification-code login: ${accountType} / ${platform} consumes code and returns correct response`, async () => {
            const account = accountType === 'email' ? 'user@example.test' : '2025550100';
            const codeKey = `${accountType}_login_code:${account}`;
            const harness = loadAccountApi({
                redisData: { 'captcha_slider:test-id': JSON.stringify({ x: 100 }), [codeKey]: '123456' },
                sql: sql => /SELECT/.test(sql) ? [{ id: 42, status: 1 }] : [],
            });
            const response = await harness.invoke('POST', `/api/account/login/${accountType}/code`, {
                body: { [accountType]: account, code: '123456', captcha_id: 'test-id', x: 100, platform },
            });
            platform === 'web' ? assertWebLogin(response) : assertAppLogin(response);
            assert.equal(harness.memory.has(codeKey), false);
            assert.equal(harness.memory.has('captcha_slider:test-id'), false);
            assert.equal(findSession(harness).login_type, `${accountType}_code`);
        });
    }
}

test('Google and Apple authorization endpoints use stubbed providers only', async () => {
    const harness = loadAccountApi();
    for (const provider of ['google', 'apple']) {
        const response = await harness.invoke('GET', `/api/account/${provider}/login`);
        assert.ok(response.redirectUrl.startsWith('https://'));
    }
    assert.equal(harness.sqlCalls.length, 0);
});

for (const provider of ['google', 'apple']) {
    for (const platform of ['web', 'app']) {
        test(`${provider} OAuth ${platform} preserves supplied token/cookie contract`, async () => {
            const harness = loadAccountApi({ sql: sql => /SELECT/.test(sql) ? [{ id: 42, nickname: 'Existing User' }] : [] });
            const route = `/api/account/${provider}/${platform === 'web' ? 'callback' : 'app'}`;
            const method = provider === 'google' && platform === 'web' ? 'GET' : 'POST';
            const response = await harness.invoke(method, route, {
                query: { code: 'test-only-code' },
                body: { code: 'test-only-code', idToken: 'test-only-google-identity', identityToken: 'test-only-apple-identity' },
            });
            // Unlike password/code login, the supplied OAuth Web callback also returns a token.
            assert.equal(response.body.success, true);
            assert.equal(response.body.data.user_id, 42);
            assert.equal(typeof response.body.data.token, 'string');
            assert.equal(response.cookies.length, platform === 'web' ? 1 : 0);
            if (platform === 'web') {
                assert.equal(response.cookies[0].options.secure, true);
                assert.equal(response.cookies[0].options.httpOnly, true);
            }
            assert.equal(findSession(harness).user_id, 42);
        });
    }
}

test('Google Web callback refuses unverified provider email before querying MySQL', async () => {
    const harness = loadAccountApi({ googlePayload: { sub: 'test-user', email: 'user@example.test', email_verified: false } });
    const response = await harness.invoke('GET', '/api/account/google/callback', { query: { code: 'test-only-code' } });
    assert.equal(response.statusCode, 400);
    assert.equal(harness.sqlCalls.length, 0);
});

test('image captcha generation stores uppercase answer with five-minute expiry', async () => {
    const harness = loadAccountApi();
    const response = await harness.invoke('POST', '/api/account/captcha/image');
    assert.equal(response.body.success, true);
    assert.ok(response.body.data.image.startsWith('data:image/svg+xml;base64,'));
    const saved = harness.redisCalls.find(call => call.method === 'set');
    assert.equal(saved.value, 'ABCD');
    assert.equal(saved.options.EX, 300);
});

test('image captcha verification consumes answer and creates a short-lived verification token', async () => {
    const harness = loadAccountApi({ redisData: { 'captcha_image:test-id': 'ABCD' } });
    const response = await harness.invoke('POST', '/api/account/captcha/image/verify', {
        body: { captcha_id: 'test-id', code: ' abcd ' },
    });
    assert.equal(response.body.success, true);
    assert.equal(harness.memory.has('captcha_image:test-id'), false);
    const saved = harness.redisCalls.find(call => call.method === 'set');
    assert.equal(saved.options.EX, 300);
    assert.equal(JSON.parse(saved.value).verified, true);
});

test('valid token can be checked, refreshed for 30 days and revoked', async () => {
    const token = 'test-only-session';
    const key = `session:${token}`;
    const harness = loadAccountApi({ redisData: { [key]: JSON.stringify({ user_id: 42 }) } });
    for (const route of ['check', 'refresh']) {
        const response = await harness.invoke('POST', `/api/account/token/${route}`, { body: { token } });
        assert.equal(response.body.success, true);
        assert.equal(response.body.data.user_id, 42);
    }
    assert.ok(harness.redisCalls.some(call => call.method === 'expire' && call.key === key && call.seconds === SESSION_TTL));
    const logout = await harness.invoke('POST', '/api/account/logout', { body: { token } });
    assert.equal(logout.body.success, true);
    assert.equal(harness.memory.has(key), false);
    const expired = await harness.invoke('POST', '/api/account/token/check', { body: { token } });
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.body.need_login, true);
});

test('MySQL failures return the supplied generic registration error without hashing or creating a session', async () => {
    const harness = loadAccountApi({ sql: () => { throw new Error('Test-only database failure'); } });
    const response = await harness.invoke('POST', '/api/account/email/register', {
        body: { email: 'user@example.test', code: '123456', password: 'test-only-password' },
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { success: false, message: '注册失败' });
    assert.equal(harness.hashCalls.length, 0);
    assert.equal(harness.redisCalls.some(call => call.method === 'set'), false);
});
