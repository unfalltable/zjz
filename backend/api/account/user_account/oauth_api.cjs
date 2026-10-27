'use strict';

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const apple = require('apple-signin-auth');

function oauthConfiguration(common) {
  const env = common.config.env;
  const base = common.config.publicOrigin;
  const configured = provider => Boolean(common.config.oauthEnabled && base?.startsWith('https://') &&
    env[`${provider.toUpperCase()}_CLIENT_ID`] && env[`${provider.toUpperCase()}_CLIENT_SECRET`]);
  return { google: configured('google'), apple: configured('apple') && common.config.secureCookie,
    callback: provider => `${base}/api/account/${provider}/callback` };
}
function createOAuthRouter(common, overrides = {}) {
  const router = express.Router();
  const { config, dbPool, redisClient, route, fail } = common;
  const oauth = oauthConfiguration(common);
  const clients = new Map();
  function enabled(provider) { if (!oauth[provider]) fail(503, 'oauth_not_configured', '此第三方登录尚未配置，请使用其他登录方式。'); }
  function googleClient() { if (!clients.has('google')) clients.set('google', new OAuth2Client({ clientId: config.env.GOOGLE_CLIENT_ID, clientSecret: config.env.GOOGLE_CLIENT_SECRET, redirectUri: oauth.callback('google'), transporterOptions: { timeout: 10000 } })); return clients.get('google'); }
  async function bounded(promise) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('oauth_timeout')), 15000); timer.unref?.(); })]); } finally { clearTimeout(timer); } }
  async function verify(provider, token, nonce, native = false) {
    enabled(provider);
    if (typeof token !== 'string' || token.length < 50 || token.length > 20000) fail(400, 'oauth_token_invalid', '第三方身份凭据无效。');
    let payload;
    try {
      if (overrides.verifyIdentity) payload = await overrides.verifyIdentity(provider, token, nonce, native);
      else if (provider === 'google') payload = (await bounded(googleClient().verifyIdToken({ idToken: token, audience: config.env.GOOGLE_CLIENT_ID }))).getPayload();
      else payload = await bounded(apple.verifyIdToken(token, { audience: native ? config.env.APPLE_APP_CLIENT_ID || config.env.APPLE_CLIENT_ID : config.env.APPLE_CLIENT_ID, ignoreExpiration: false, ...(nonce ? { nonce } : {}) }));
    } catch { fail(401, 'oauth_token_invalid', '第三方身份验证失败，请重新登录。'); }
    if (!payload || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 ||
      (nonce && !common.secureEqual(payload.nonce, nonce)) || !Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= Math.floor(common.clock() / 1000) ||
      !Number.isFinite(Number(payload.iat)) || Number(payload.iat) > Math.floor(common.clock() / 1000) + 60 ||
      (native && Math.floor(common.clock() / 1000) - Number(payload.iat) > 900)) fail(401, 'oauth_token_invalid', '第三方身份凭据无效或已过期。');
    return payload;
  }
  async function socialUser(provider, payload) {
    const column = provider === 'google' ? 'google_sub' : 'apple_sub';
    const [rows] = await dbPool.execute(`SELECT * FROM users WHERE ${column} = ? LIMIT 1`, [payload.sub]);
    if (rows[0]) return rows[0];
    const verified = payload.email_verified === true || payload.email_verified === 'true';
    const email = verified ? common.normalizeEmail(payload.email) : null;
    // A matching email alone never silently links somebody else's existing account.
    const [result] = await dbPool.execute(`INSERT INTO users (${column}, email, nickname, status, auth_version, created_at, updated_at, last_login_at) VALUES (?, ?, ?, 1, 0, NOW(), NOW(), NOW())`, [payload.sub, email, 'Member']);
    const [created] = await dbPool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [String(result.insertId)]);
    if (!created[0]) fail(503, 'account_service_unavailable', '账号服务暂不可用。');
    return created[0];
  }
  const cookieName = 'account_oauth_state';
  function stateCookie(provider) { return { httpOnly: true, secure: true, sameSite: provider === 'apple' ? 'none' : 'lax', path: '/api/account', maxAge: 10 * 60 * 1000 }; }
  for (const provider of ['google', 'apple']) {
    router.get(`/api/account/${provider}/login`, route(async (req, res) => {
      enabled(provider);
      if (!await common.checkIpRateLimit(req.ip || 'unknown', 'oauth_start', 20)) fail(429, 'rate_limited', '请稍后重试。');
      const state = common.randomToken(), nonce = common.randomToken();
      await redisClient.set(`account:v2:oauth:${common.digest(state)}`, JSON.stringify({ provider, nonce }), { EX: 600 });
      res.cookie(cookieName, state, stateCookie(provider));
      const url = provider === 'google' ? new URL('https://accounts.google.com/o/oauth2/v2/auth') : new URL('https://appleid.apple.com/auth/authorize');
      url.searchParams.set('client_id', config.env[`${provider.toUpperCase()}_CLIENT_ID`]);
      url.searchParams.set('redirect_uri', oauth.callback(provider)); url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', provider === 'google' ? 'openid email profile' : 'name email');
      url.searchParams.set('state', state); url.searchParams.set('nonce', nonce);
      if (provider === 'apple') url.searchParams.set('response_mode', 'form_post');
      res.redirect(302, url.href);
    }));
    const callback = route(async (req, res) => {
      enabled(provider);
      const incoming = provider === 'google' ? req.query : req.body;
      const state = incoming.state;
      if (!common.validToken(state) || !common.secureEqual(req.cookies?.[cookieName], state)) fail(400, 'oauth_state_invalid', '登录事务已失效，请重新开始。');
      const raw = await redisClient.getDel(`account:v2:oauth:${common.digest(state)}`);
      res.clearCookie(cookieName, { ...stateCookie(provider), maxAge: undefined });
      let transaction; try { transaction = JSON.parse(raw); } catch { /* invalid or already consumed */ }
      if (!transaction || transaction.provider !== provider || !common.validToken(transaction.nonce)) fail(400, 'oauth_state_invalid', '登录事务已失效，请重新开始。');
      if (typeof incoming.code !== 'string' || !incoming.code || incoming.code.length > 5000) fail(400, 'oauth_code_invalid', '登录未完成，请重新开始。');
      let token;
      try {
        const endpoint = provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://appleid.apple.com/auth/token';
        const response = await (overrides.fetch || fetch)(endpoint, { method: 'POST', signal: AbortSignal.timeout(15000), redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code: incoming.code, client_id: config.env[`${provider.toUpperCase()}_CLIENT_ID`], client_secret: config.env[`${provider.toUpperCase()}_CLIENT_SECRET`], redirect_uri: oauth.callback(provider), grant_type: 'authorization_code' }) });
        const result = await response.json(); if (!response.ok || typeof result.id_token !== 'string') throw new Error('oauth_exchange_failed'); token = result.id_token;
      } catch { fail(401, 'oauth_exchange_failed', '第三方登录未完成，请重新开始。'); }
      const payload = await verify(provider, token, transaction.nonce);
      await common.issueSession({ ...req, body: { platform: 'web' } }, res, await socialUser(provider, payload), provider);
      res.redirect(302, '/account');
    });
    if (provider === 'google') router.get(`/api/account/${provider}/callback`, callback);
    else router.post(`/api/account/${provider}/callback`, callback);
    router.post(`/api/account/${provider}/app`, route(async (req, res) => {
      enabled(provider); if (!await common.checkIpRateLimit(req.ip || 'unknown', 'oauth_app', 20)) fail(429, 'rate_limited', '请稍后重试。');
      const payload = await verify(provider, provider === 'google' ? req.body.idToken : req.body.identityToken, null, true);
      res.json({ success: true, message: '登录成功', data: await common.issueSession({ ...req, body: { ...req.body, platform: 'app' } }, res, await socialUser(provider, payload), provider) });
    }));
  }
  router.post('/api/account/oauth/bind', route(async (req, res) => {
    const session = await common.requireSession(req);
    const provider = req.body.provider; if (!['google', 'apple'].includes(provider)) fail(400, 'provider_invalid', '请选择 Google 或 Apple。');
    await common.requireAccountProof(req, session.user);
    const payload = await verify(provider, provider === 'google' ? req.body.idToken : req.body.identityToken, null, true);
    const column = provider === 'google' ? 'google_sub' : 'apple_sub';
    const connection = await dbPool.getConnection();
    try { await connection.beginTransaction(); const [rows] = await connection.execute('SELECT * FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [session.user_id]);
      const user = rows[0]; if (!user || Number(user.status) !== 1 || String(user.auth_version) !== String(session.auth_version) || user[column]) fail(409, 'account_changed', '账号已变化或该登录方式已绑定。');
      await connection.execute(`UPDATE users SET ${column} = ?, auth_version = auth_version + 1, updated_at = NOW() WHERE id = ?`, [payload.sub, session.user_id]); await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    res.clearCookie('token', { ...common.cookieOptions(), maxAge: undefined }); res.json({ success: true, message: '第三方账号已绑定，请重新登录。' });
  }));
  return router;
}
module.exports = { createOAuthRouter, oauthConfiguration };
