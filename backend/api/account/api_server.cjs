'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const { createCommon, readConfig } = require('./common/common.cjs');
const { createCaptchaRouter } = require('./captcha/captcha_api.cjs');
const { createSenderRouter } = require('./sender/send_code_api.cjs');
const { createDelivery } = require('./sender/sender.cjs');
const { createUserAccountRouter } = require('./user_account/user_account_api.cjs');
const { createOAuthRouter, oauthConfiguration } = require('./user_account/oauth_api.cjs');
const { createProfileRouter } = require('./user_account/account_profile_api.cjs');

function createAccountApp(dependencies) {
  const common = createCommon(dependencies);
  const delivery = dependencies.delivery || createDelivery(common.config);
  common.delivery = delivery;
  const app = express();
  app.disable('x-powered-by');
  // Never trust arbitrary Internet-supplied Forwarded or X-Forwarded-For headers.
  app.set('trust proxy', common.config.env.ACCOUNT_TRUST_PROXY === 'loopback' ? 'loopback' : false);
  app.use(cookieParser()); app.use(common.cors);
  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 15 }));
  app.use((req, _res, next) => {
    if (req.method === 'POST' && !req.is('multipart/form-data') && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) req.body = {};
    next();
  });
  app.get('/health', (_req, res) => res.json({ success: true, message: 'ok' }));
  app.get('/api/account/config', (_req, res) => {
    const providers = oauthConfiguration(common);
    const data = { email: Boolean(delivery.capabilities.email), sms: Boolean(delivery.capabilities.sms), google: Boolean(providers.google), apple: Boolean(providers.apple), password: true,
      avatar: Boolean(common.config.uploadPath), codes: { email: delivery.capabilities.email ? 'configured' : 'not_configured', sms: delivery.capabilities.sms ? 'configured' : 'not_configured', google: providers.google ? 'configured' : 'not_configured', apple: providers.apple ? 'configured' : 'not_configured' } };
    res.json({ success: true, message: 'ok', data });
  });
  app.use(createCaptchaRouter(common)); app.use(createSenderRouter(common, delivery));
  app.use(createUserAccountRouter(common)); app.use(createOAuthRouter(common, dependencies.oauth || {})); app.use(createProfileRouter(common));
  app.use((_req, res) => res.status(404).json({ success: false, code: 'not_found', message: '接口不存在。' }));
  app.use(common.errorHandler);
  return app;
}

async function start(environment = process.env) {
  const port = Number(environment.ACCOUNT_PORT || 3002);
  const host = environment.ACCOUNT_HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Account service requires a valid loopback host and port.');
  const config = readConfig(environment);
  if (config.production && !config.publicOrigin) throw new Error('Configure ACCOUNT_PUBLIC_ORIGIN before production startup.');
  const database = environment.MYSQL_DATABASE || environment.DB_NAME;
  const user = environment.MYSQL_USER || environment.DB_USER;
  const password = environment.MYSQL_PASSWORD ?? environment.DB_PASSWORD;
  if (!database || !user || (config.production && !password)) throw new Error('Configure a dedicated MySQL account database and credentials.');
  const dbPool = require('mysql2/promise').createPool({ host: environment.MYSQL_HOST || environment.DB_HOST || '127.0.0.1', port: Number(environment.MYSQL_PORT || environment.DB_PORT || 3306), user, password: password || '', database,
    waitForConnections: true, connectionLimit: 10, queueLimit: 100, connectTimeout: 10000, supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z' });
  const redisClient = require('redis').createClient({ url: environment.REDIS_URL || 'redis://127.0.0.1:6379', socket: { connectTimeout: 10000, reconnectStrategy: false } });
  redisClient.on('error', () => { /* Do not log drivers: URLs may contain credentials. */ });
  try {
    await redisClient.connect();
    // Schema readiness checks are read-only. Importing this service never runs DDL.
    await dbPool.execute('SELECT id, email, phone, nickname, avatar_url, status, auth_version FROM users LIMIT 0');
    await dbPool.execute('SELECT user_id, restriction_type, expire_at, status FROM account_restrictions LIMIT 0');
    await dbPool.execute('SELECT user_id, status FROM account_deletion_requests LIMIT 0');
    if (config.production) {
      const { auditAccountSchema } = require('../../sql/account/audit-schema.cjs');
      const audit = await auditAccountSchema(dbPool, { scanData: false });
      if (!audit.ok) throw new Error('Account schema has not passed its read-only production audit.');
    }
    const app = createAccountApp({ dbPool, redisClient, config });
    const server = await new Promise((resolve, reject) => { const running = app.listen(port, host, () => resolve(running)); running.once('error', reject); });
    async function close() { await new Promise(resolve => server.close(resolve)); if (redisClient.isOpen) await redisClient.quit(); await dbPool.end(); }
    console.info(`[account-api] Ready on loopback port ${port}.`);
    return { server, close, dbPool, redisClient };
  } catch (error) { if (redisClient.isOpen) redisClient.destroy(); await dbPool.end(); throw error; }
}

function runCLI() {
  return start().then(({ close }) => { let stopping = false; for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (stopping) return; stopping = true; const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref(); close().then(() => clearTimeout(deadline)).catch(() => { process.exitCode = 1; }); }); })
    .catch(() => { console.error('[account-api] Startup failed. Check account database, Redis, public origin and reviewed schema.'); process.exitCode = 1; });
}
module.exports = { createAccountApp, start, runCLI };
if (require.main === module) runCLI();
