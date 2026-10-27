'use strict';

const crypto = require('node:crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js/max');

class AccountError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new AccountError(status, code, message); }
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('hex');
const validToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@,;<>:"\\()[\]]+@[^\s@,;<>:"\\()[\]]+\.[^\s@,;<>:"\\()[\]]+$/.test(email)) return null;
  const [local, rawDomain] = email.split('@');
  const domain = require('node:url').domainToASCII(rawDomain);
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !domain || domain.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) return null;
  return `${local}@${domain}`;
}
function phoneParts(countryCode, value) {
  if (typeof value !== 'string') return null;
  const phone = value.replace(/[ ()-]/g, '');
  const prefix = typeof countryCode === 'string' ? countryCode.replace(/^00/, '+').trim() : '';
  if (prefix && !/^\+[1-9]\d{0,3}$/.test(prefix)) return null;
  const full = phone.startsWith('+') ? phone : prefix ? `${prefix}${phone}` : '';
  if (!/^\+[1-9]\d{6,14}$/.test(full)) return null;
  const parsed = parsePhoneNumberFromString(full);
  if (!parsed || !parsed.isValid() || parsed.ext || (prefix && prefix !== `+${parsed.countryCallingCode}`)) return null;
  return { e164: parsed.number, countryCode: `+${parsed.countryCallingCode}`, nationalNumber: parsed.nationalNumber };
}
function normalizePhone(countryCode, value) { return phoneParts(countryCode, value)?.e164 || null; }
function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function origin(value, production = false) {
  if (!value) return null;
  try { const parsed = new URL(value); return !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash &&
    (parsed.protocol === 'https:' || (!production && parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) ? parsed.origin : null; } catch { return null; }
}
function readConfig(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const publicOrigin = origin(environment.ACCOUNT_PUBLIC_ORIGIN, production);
  if (environment.ACCOUNT_PUBLIC_ORIGIN && !publicOrigin) fail(503, 'configuration_invalid', 'Invalid account public origin configuration.');
  const allowedOrigins = [...new Set([publicOrigin, ...(environment.ACCOUNT_ALLOWED_ORIGINS || '').split(',').map(value => origin(value.trim(), production))].filter(Boolean))];
  if (!production && !allowedOrigins.length) allowedOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173');
  return { production, publicOrigin, allowedOrigins, secureCookie: production || publicOrigin?.startsWith('https:') || environment.ACCOUNT_COOKIE_SECURE === 'true',
    sessionTTL: 30 * 24 * 60 * 60, sessionMaxAge: 90 * 24 * 60 * 60, uploadPath: environment.ACCOUNT_UPLOAD_PATH || '',
    profileBirthEnabled: environment.ACCOUNT_PROFILE_BIRTH_ENABLED === 'true', oauthEnabled: environment.ACCOUNT_OAUTH_ENABLED === 'true', env: environment };
}
function tokenFrom(req) {
  const header = req.headers?.authorization;
  const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
  const values = [bearer, req.cookies?.token, req.body?.token].filter(Boolean);
  if (!values.length || values.some(value => !validToken(value)) || new Set(values).size !== 1) return null;
  return values[0];
}
const sessionKey = token => `account:v2:session:${digest(token)}`;
function publicUser(user) {
  return { user_id: String(user.id), nickname: user.nickname || '', avatar_url: user.avatar_url || null,
    email: user.email || null, backup_email: user.backup_email || null, phone: user.phone || null,
    phone_country_code: user.phone_country_code || null, country: user.country || null, status: Number(user.status),
    has_google: Boolean(user.google_sub), has_apple: Boolean(user.apple_sub), created_at: user.created_at || null,
    last_login_at: user.last_login_at || null };
}
const rateScript = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`;
const captchaConsumeScript = `local v=redis.call('GET',KEYS[1]); if not v or v~=ARGV[1] then return 0 end; redis.call('DEL',KEYS[1]); return 1`;
const codeConsumeScript = `local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end; local ok,v=pcall(cjson.decode,raw); if not ok then redis.call('DEL',KEYS[1]);return 0 end; if v.hash==ARGV[1] then redis.call('DEL',KEYS[1]);return 1 end; v.attempts=(v.attempts or 0)+1; if v.attempts>=5 then redis.call('DEL',KEYS[1]) else local ttl=redis.call('TTL',KEYS[1]);if ttl>0 then redis.call('SET',KEYS[1],cjson.encode(v),'EX',ttl) else redis.call('DEL',KEYS[1]) end end;return 0`;
const refreshScript = `local raw=redis.call('GET',KEYS[1]);if not raw or raw~=ARGV[1] then return 0 end;redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]);return 1`;

/** Explicit injected dependencies: importing the module never opens network connections. */
function createCommon({ dbPool, redisClient, config = readConfig(), clock = Date.now }) {
  const codeKey = (kind, target) => { if (!['email_register', 'phone_register', 'email_login', 'phone_login', 'backup_email', 'email_reset', 'phone_reset', 'email_security', 'phone_security', 'backup_email_security'].includes(kind) || typeof target !== 'string') fail(400, 'invalid_code', '验证码无效。'); return `account:v2:otp:${kind}:${digest(target)}`; };
  const clientKey = req => digest(String(req.ip || req.socket?.remoteAddress || 'unknown'));
  async function checkIpRateLimit(ip, type, limit) {
    if (!/^[a-z0-9_-]{1,60}$/i.test(type) || !Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid_rate_limit');
    const count = await redisClient.eval(rateScript, { keys: [`account:v2:rate:${type}:${digest(ip)}`], arguments: ['60'] });
    return Number(count) <= limit;
  }
  async function getSession(req) {
    const token = tokenFrom(req); if (!token) return null;
    const raw = await redisClient.get(sessionKey(token)); if (!raw) return null;
    let value; try { value = JSON.parse(raw); } catch { return null; }
    if (!value || !/^\d{1,20}$/.test(String(value.user_id)) || !Number.isSafeInteger(value.issued_at) || clock() / 1000 - value.issued_at > config.sessionMaxAge) return null;
    const [rows] = await dbPool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [String(value.user_id)]);
    const user = rows[0];
    if (!user || Number(user.status) !== 1 || String(user.auth_version ?? 0) !== String(value.auth_version)) return null;
    const [restrictions] = await dbPool.execute("SELECT restriction_type, reason, created_at, expire_at FROM account_restrictions WHERE user_id = ? AND status = 1 AND (expire_at IS NULL OR expire_at > ?)", [String(user.id), Math.floor(clock() / 1000)]);
    if (restrictions.some(item => ['login', 'all'].includes(item.restriction_type))) return null;
    return { ...value, user_id: String(user.id), user, token, raw, restrictions };
  }
  async function requireSession(req) { const value = await getSession(req); if (!value) fail(401, 'authentication_required', '请先登录，或重新验证账号。'); return value; }
  function cookieOptions() { return { httpOnly: true, secure: Boolean(config.secureCookie), sameSite: 'lax', path: '/', maxAge: config.sessionTTL * 1000 }; }
  async function issueSession(req, res, user, loginType) {
    if (Number(user.status) !== 1) fail(403, 'account_unavailable', '账号暂不可登录。');
    const [restrictions] = await dbPool.execute("SELECT restriction_type FROM account_restrictions WHERE user_id = ? AND status = 1 AND (expire_at IS NULL OR expire_at > ?)", [String(user.id), Math.floor(clock() / 1000)]);
    if (restrictions.some(item => ['login', 'all'].includes(item.restriction_type))) fail(403, 'account_unavailable', '账号暂不可登录。');
    const token = randomToken();
    await redisClient.set(sessionKey(token), JSON.stringify({ user_id: String(user.id), auth_version: String(user.auth_version ?? 0), issued_at: Math.floor(clock() / 1000), verified_at: Math.floor(clock() / 1000) }), { EX: config.sessionTTL });
    if (req.body?.platform !== 'app') res.cookie('token', token, cookieOptions());
    const accountType = loginType || (req.body?.email ? 'email' : req.body?.phone ? 'phone' : req.body?.account ? normalizeEmail(req.body.account) ? 'email' : 'phone' : user.email ? 'email' : 'phone');
    const account = accountType === 'phone' ? normalizePhone(user.phone_country_code, user.phone) : normalizeEmail(user.email);
    return { user_id: String(user.id), account, account_type: accountType, ...(req.body?.platform === 'app' ? { token } : {}), expires_in: config.sessionTTL, user: publicUser(user) };
  }
  async function setCaptchaToken(req) { const token = randomToken(); await redisClient.set(`account:v2:captcha-token:${digest(token)}`, clientKey(req), { EX: 300 }); return token; }
  async function consumeCaptchaToken(req, value) { return validToken(value) && Number(await redisClient.eval(captchaConsumeScript, { keys: [`account:v2:captcha-token:${digest(value)}`], arguments: [clientKey(req)] })) === 1; }
  async function storeCode(kind, target, code, ttl = 300) { await redisClient.set(codeKey(kind, target), JSON.stringify({ hash: digest(code), attempts: 0 }), { EX: ttl }); }
  async function consumeCode(kind, target, code) { return typeof code === 'string' && /^\d{6}$/.test(code) && Number(await redisClient.eval(codeConsumeScript, { keys: [codeKey(kind, target)], arguments: [digest(code)] })) === 1; }
  async function requireAccountProof(req, user) {
    const supplied = req.body.old_password ?? req.body.password;
    if (typeof supplied === 'string' && Buffer.byteLength(supplied, 'utf8') <= 72 && typeof user.password === 'string' && await require('bcrypt').compare(supplied, user.password)) return;
    const kind = req.body.code_type;
    const target = kind === 'email' ? normalizeEmail(user.email) : kind === 'backup_email' ? normalizeEmail(user.backup_email) : kind === 'phone' ? normalizePhone(user.phone_country_code, user.phone) : null;
    if (target && await consumeCode(kind === 'phone' ? 'phone_security' : kind === 'backup_email' ? 'backup_email_security' : 'email_security', target, req.body.code)) return;
    fail(403, 'reauthentication_required', '请用当前密码或当前已绑定联系方式验证码再次验证。');
  }
  function cors(req, res, next) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.vary('Origin');
    const requested = req.headers.origin;
    const appleCallback = req.method === 'POST' && req.path === '/api/account/apple/callback' && requested === 'https://appleid.apple.com';
    if (req.method === 'POST' && req.cookies?.token && !appleCallback && !config.allowedOrigins.includes(requested)) return res.status(403).json({ success: false, code: 'origin_rejected', message: 'Cookie 请求需要受信任来源。' });
    if (req.headers['sec-fetch-site'] === 'cross-site' && !appleCallback && !config.allowedOrigins.includes(requested)) return res.status(403).json({ success: false, code: 'origin_rejected', message: '来源不受信任。' });
    if (requested && !config.allowedOrigins.includes(requested) && !appleCallback) return res.status(403).json({ success: false, code: 'origin_rejected', message: '来源不受信任。' });
    if (requested && config.allowedOrigins.includes(requested)) { res.setHeader('Access-Control-Allow-Origin', requested); res.setHeader('Access-Control-Allow-Credentials', 'true'); }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  }
  function route(handler) { return async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } }; }
  function errorHandler(error, _req, res, _next) {
    if (res.headersSent) return;
    const known = error instanceof AccountError;
    const duplicate = error?.code === 'ER_DUP_ENTRY';
    const tooLarge = error?.type === 'entity.too.large' || error?.code === 'LIMIT_FILE_SIZE';
    const invalid = error?.type === 'entity.parse.failed' || error?.code === 'LIMIT_UNEXPECTED_FILE';
    res.status(known ? error.status : duplicate ? 409 : tooLarge ? 413 : invalid ? 400 : 503).json({ success: false,
      code: known ? error.code : duplicate ? 'account_conflict' : tooLarge ? 'payload_too_large' : invalid ? 'request_invalid' : 'account_service_unavailable',
      message: known ? error.message : duplicate ? '账号或联系方式已被使用，请重新核对。' : tooLarge ? '提交内容超过允许大小。' : invalid ? '提交内容格式无效。' : '账号服务暂不可用，请稍后重试。' });
  }
  return { dbPool, redisClient, config, clock, fail, route, errorHandler, cors, checkIpRateLimit, getSession, requireSession, issueSession, cookieOptions,
    tokenFrom, sessionKey, publicUser, digest, secureEqual, randomToken, validToken, clientKey, normalizeEmail, normalizePhone, phoneParts, codeKey, storeCode, consumeCode, requireAccountProof, setCaptchaToken, consumeCaptchaToken,
    async refreshSession(session) { return Number(await redisClient.eval(refreshScript, { keys: [sessionKey(session.token)], arguments: [session.raw, String(config.sessionTTL)] })) === 1; } };
}

module.exports = { createCommon, readConfig, AccountError, fail, digest, randomToken, validToken, tokenFrom, sessionKey, publicUser, normalizeEmail, normalizePhone, phoneParts, secureEqual };
