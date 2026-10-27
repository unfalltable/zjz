'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { consumeSlider } = require('../captcha/captcha_api.cjs');
const { oauthConfiguration } = require('./oauth_api.cjs');

function createUserAccountRouter(common) {
  const { dbPool, redisClient, config, route, fail, requireSession, publicUser, normalizeEmail, normalizePhone, consumeCode, issueSession } = common;
  const router = express.Router();
  const clean = (value, max = 200) => typeof value === 'string' && !/[\u0000-\u001f\u007f]/.test(value) && value.trim().length <= max ? value.trim() : null;
  function password(value) { if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value, 'utf8') > 72) fail(400, 'password_invalid', '密码至少 8 个字符，最多 72 个 UTF-8 字节。'); return value; }
  function phone(body) { const result = normalizePhone(body.phone_country_code, body.phone ?? body.account); if (!result) fail(400, 'phone_invalid', '请输入完整国际区号和手机号。'); return result; }
  function email(value) { const result = normalizeEmail(value); if (!result) fail(400, 'email_invalid', '请输入有效邮箱。'); return result; }
  async function findById(id, connection = dbPool, lock = false) { const [rows] = await connection.execute(`SELECT * FROM users WHERE id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [String(id)]); return rows[0] || null; }
  async function findAccount(body) {
    const target = normalizeEmail(body.account);
    if (target) { const [rows] = await dbPool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [target]); return rows[0] || null; }
    const parts = common.phoneParts(body.phone_country_code, body.account);
    if (!parts) return null;
    const [rows] = await dbPool.execute('SELECT * FROM users WHERE phone = ? AND phone_country_code = ? LIMIT 1', [parts.nationalNumber, parts.countryCode]); return rows[0] || null;
  }
  async function challenge(req) {
    if (req.body.captcha_token) {
      if (!await common.consumeCaptchaToken(req, req.body.captcha_token)) fail(400, 'captcha_invalid', '验证码已失效，请重新验证。');
    } else if (!await consumeSlider(common, req, req.body.captcha_id, req.body.x)) fail(400, 'captcha_invalid', '请先完成验证码验证。');
  }
  async function limited(req, name, amount = 20) { if (!await common.checkIpRateLimit(req.ip || 'unknown', name, amount)) fail(429, 'rate_limited', '操作过于频繁，请稍后重试。'); }
  const reauthenticate = common.requireAccountProof;
  function clearSession(res) { res.clearCookie('token', { ...common.cookieOptions(), maxAge: undefined }); }
  async function withAccountLock(session, work) {
    const connection = await dbPool.getConnection();
    try {
      await connection.beginTransaction();
      const current = await findById(session.user_id, connection, true);
      if (!current || Number(current.status) !== 1 || String(current.auth_version ?? 0) !== String(session.auth_version)) fail(409, 'account_changed', '账号已变化，请重新登录。');
      const result = await work(connection, current);
      await connection.commit(); return result;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
  async function revoke(connection, id) { await connection.execute('UPDATE users SET auth_version = auth_version + 1, updated_at = NOW() WHERE id = ?', [String(id)]); }
  const post = (path, handler) => router.post(`/api/account/${path}`, route(handler));

  for (const channel of ['email', 'phone']) post(`${channel}/register`, async (req, res) => {
    await limited(req, 'register', 10);
    const target = channel === 'email' ? email(req.body.email) : phone(req.body);
    const secret = password(req.body.password);
    if (!await consumeCode(`${channel}_register`, target, req.body.code)) fail(400, 'code_invalid', '验证码错误或已失效。');
    const hash = await bcrypt.hash(secret, 12);
    const parts = channel === 'phone' ? common.phoneParts(req.body.phone_country_code, target) : null;
    const nickname = clean(req.body.nickname ?? '', 100); if (nickname === null) fail(400, 'nickname_invalid', '昵称无效。');
    const [result] = await dbPool.execute(`INSERT INTO users (email, phone, phone_country_code, password, nickname, status, auth_version, country, created_at, updated_at, last_login_at, last_login_ip) VALUES (?, ?, ?, ?, ?, 1, 0, ?, NOW(), NOW(), NOW(), ?)`,
      [channel === 'email' ? target : null, parts?.nationalNumber || null, parts?.countryCode || null, hash, nickname, clean(req.body.country ?? '', 100), String(req.ip || '').slice(0, 45)]);
    const user = await findById(String(result.insertId));
    if (!user) fail(503, 'account_service_unavailable', '账号创建后暂时无法登录，请稍后重试。');
    res.status(201).json({ success: true, message: '注册成功', data: await issueSession(req, res, user) });
  });

  post('login/password', async (req, res) => {
    await limited(req, 'password_login', 10); await challenge(req);
    const user = await findAccount(req.body);
    // Always run bcrypt, including nonexistent and OAuth-only accounts.
    const hash = user?.password || '$2b$12$2nGdV3CSJgUJdCP5aObJwu0HsQzbZaq4R7TMJepn2y0P5WftAxRPy';
    const valid = typeof req.body.password === 'string' && Buffer.byteLength(req.body.password) <= 72 && await bcrypt.compare(req.body.password, hash);
    if (!valid || !user || !user.password) fail(401, 'credentials_invalid', '账号或密码错误。');
    await dbPool.execute('UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?', [String(req.ip || '').slice(0, 45), String(user.id)]);
    res.json({ success: true, message: '登录成功', data: await issueSession(req, res, user) });
  });
  for (const channel of ['email', 'phone']) post(`login/${channel}/code`, async (req, res) => {
    await limited(req, 'code_login', 15);
    const target = channel === 'email' ? email(req.body.email ?? req.body.account) : phone(req.body);
    if (!await consumeCode(`${channel}_login`, target, req.body.code)) fail(401, 'credentials_invalid', '账号或验证码无效。');
    const parts = channel === 'phone' ? common.phoneParts(req.body.phone_country_code, target) : null;
    const [rows] = channel === 'phone' ? await dbPool.execute('SELECT * FROM users WHERE phone = ? AND phone_country_code = ? LIMIT 1', [parts.nationalNumber, parts.countryCode]) : await dbPool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [target]);
    if (!rows[0]) fail(401, 'credentials_invalid', '账号或验证码无效。');
    res.json({ success: true, message: '登录成功', data: await issueSession(req, res, rows[0]) });
  });
  post('me', async (req, res) => res.json({ success: true, message: 'ok', data: publicUser((await requireSession(req)).user) }));
  post('token/check', async (req, res) => {
    const session = await requireSession(req);
    res.json({ success: true, message: 'Token有效', data: { valid: true, user_id: session.user_id, user: publicUser(session.user) } });
  });
  post('token/refresh', async (req, res) => {
    const session = await requireSession(req);
    if (!await common.refreshSession(session)) fail(401, 'session_expired', '会话已结束，请重新登录。');
    if (req.body.platform !== 'app') res.cookie('token', session.token, common.cookieOptions());
    res.json({ success: true, message: '会话已续期', data: { expires_in: config.sessionTTL } });
  });
  post('logout', async (req, res) => {
    const token = common.tokenFrom(req); if (token) await redisClient.del(common.sessionKey(token));
    clearSession(res); res.json({ success: true, message: '已退出登录' });
  });
  post('restrictions', async (req, res) => res.json({ success: true, message: 'ok', data: { restrictions: (await requireSession(req)).restrictions } }));
  post('nickname', async (req, res) => {
    const session = await requireSession(req); const nickname = clean(req.body.nickname, 100);
    if (!nickname) fail(400, 'nickname_invalid', '昵称不能为空且最多 100 个字符。');
    await dbPool.execute('UPDATE users SET nickname = ?, updated_at = NOW() WHERE id = ? AND auth_version = ?', [nickname, session.user_id, session.auth_version]);
    res.json({ success: true, message: '昵称已更新', data: { nickname } });
  });

  post('password/change', async (req, res) => {
    await limited(req, 'security_change', 10); const session = await requireSession(req);
    await reauthenticate(req, session.user); const hash = await bcrypt.hash(password(req.body.new_password), 12);
    await withAccountLock(session, async (connection, user) => { await connection.execute('UPDATE users SET password = ? WHERE id = ?', [hash, String(user.id)]); await revoke(connection, user.id); });
    clearSession(res); res.json({ success: true, message: '密码已修改，所有设备需要重新登录。' });
  });
  post('password/reset', async (req, res) => {
    await limited(req, 'password_reset', 10); const newPassword = password(req.body.new_password);
    const user = await findAccount(req.body);
    const target = normalizeEmail(req.body.account) || normalizePhone(req.body.phone_country_code, req.body.account);
    if (!target || !await consumeCode(target.includes('@') ? 'email_reset' : 'phone_reset', target, req.body.code) || !user) fail(400, 'code_invalid', '账号或验证码无效。');
    const hash = await bcrypt.hash(newPassword, 12);
    const connection = await dbPool.getConnection();
    try { await connection.beginTransaction(); const current = await findById(user.id, connection, true); if (!current || Number(current.status) !== 1 || String(current.auth_version ?? 0) !== String(user.auth_version ?? 0) || (normalizeEmail(current.email) !== target && normalizePhone(current.phone_country_code, current.phone) !== target)) fail(409, 'account_changed', '账号已变化，请重新验证。'); await connection.execute('UPDATE users SET password = ? WHERE id = ?', [hash, String(user.id)]); await revoke(connection, user.id); await connection.commit(); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    clearSession(res); res.json({ success: true, message: '密码已重置，请重新登录。' });
  });
  for (const channel of ['email', 'phone', 'backup-email']) post(`${channel}/bind`, async (req, res) => {
    await limited(req, 'security_bind', 10); const session = await requireSession(req); await reauthenticate(req, session.user);
    const target = channel === 'phone' ? phone(req.body) : email(channel === 'email' ? req.body.email : req.body.backup_email);
    if (channel === 'backup-email' && target === session.user.email) fail(400, 'backup_email_invalid', '辅助邮箱应与登录邮箱不同。');
    const proof = req.body.new_code ?? req.body.code;
    if (!await consumeCode(channel === 'phone' ? 'phone_register' : channel === 'email' ? 'email_register' : 'backup_email', target, proof)) fail(400, 'code_invalid', '新联系方式验证码错误或已失效。');
    await withAccountLock(session, async (connection, user) => {
      if (channel === 'phone') { const parts = common.phoneParts(req.body.phone_country_code, target); await connection.execute('UPDATE users SET phone = ?, phone_country_code = ? WHERE id = ?', [parts.nationalNumber, parts.countryCode, String(user.id)]); }
      else await connection.execute(`UPDATE users SET ${channel === 'email' ? 'email' : 'backup_email'} = ? WHERE id = ?`, [target, String(user.id)]);
      await revoke(connection, user.id);
    }); clearSession(res); res.json({ success: true, message: '联系方式已更新，请重新登录。' });
  });
  for (const channel of ['email', 'phone', 'backup-email', 'oauth']) post(channel === 'backup-email' ? 'backup-email/delete' : `${channel}/unbind`, async (req, res) => {
    await limited(req, 'security_unbind', 10); const session = await requireSession(req); await reauthenticate(req, session.user);
    const field = channel === 'oauth' ? req.body.provider === 'google' ? 'google_sub' : req.body.provider === 'apple' ? 'apple_sub' : null : channel === 'backup-email' ? 'backup_email' : channel;
    if (!field) fail(400, 'provider_invalid', '请选择 Google 或 Apple。');
    await withAccountLock(session, async (connection, user) => {
      if (field !== 'backup_email') {
        const oauth = oauthConfiguration(common);
        const available = { email: Boolean(user.email && (user.password || common.delivery?.capabilities.email)), phone: Boolean(user.phone && (user.password || common.delivery?.capabilities.sms)), google_sub: Boolean(user.google_sub && oauth.google), apple_sub: Boolean(user.apple_sub && oauth.apple) }; available[field] = false;
        if (!Object.values(available).some(Boolean)) fail(409, 'last_login_method', '必须至少保留一种登录方式。');
      }
      await connection.execute(`UPDATE users SET ${field} = NULL${field === 'phone' ? ', phone_country_code = NULL' : ''} WHERE id = ?`, [String(user.id)]); await revoke(connection, user.id);
    }); clearSession(res); res.json({ success: true, message: '绑定已移除，请重新登录。' });
  });
  post('delete/apply', async (req, res) => {
    await limited(req, 'delete_apply', 5); const session = await requireSession(req); await reauthenticate(req, session.user);
    const reason = clean(req.body.reason ?? '', 500); if (reason === null) fail(400, 'reason_invalid', '注销原因最多 500 字。');
    await withAccountLock(session, async (connection, user) => { const [existing] = await connection.execute('SELECT id FROM account_deletion_requests WHERE user_id = ? AND status = 0 LIMIT 1', [String(user.id)]); if (!existing.length) await connection.execute('INSERT INTO account_deletion_requests (user_id, reason, status, created_at) VALUES (?, ?, 0, NOW())', [String(user.id), reason]); await revoke(connection, user.id); });
    clearSession(res); res.json({ success: true, message: '注销申请已登记，尚未删除账号；请联系客服处理。' });
  });
  return router;
}
module.exports = { createUserAccountRouter };
