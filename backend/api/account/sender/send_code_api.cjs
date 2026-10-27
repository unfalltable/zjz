'use strict';

const express = require('express');
const crypto = require('node:crypto');
const { createDelivery } = require('./sender.cjs');

const routes = [
  ['/api/account/email/send-code', 'email_register', 'email', false],
  ['/api/account/phone/send-code', 'phone_register', 'phone', false],
  ['/api/account/email/login/send-code', 'email_login', 'email', true],
  ['/api/account/phone/login/send-code', 'phone_login', 'phone', true],
  ['/api/account/backup-email/send-code', 'backup_email', 'email', false],
];
const publicMessage = '如果该账号可以接收验证码，验证码将发送。If this account is eligible, a verification code will be sent.';

function createSenderRouter(common, delivery = createDelivery(common.config)) {
  const router = express.Router();
  for (const [path, defaultKind, channel, registered] of routes) {
    router.post(path, common.route(async (req, res) => {
      if (!delivery.capabilities[channel === 'phone' ? 'sms' : 'email']) throw common.fail(503, 'delivery_unavailable', channel === 'email' ? '邮箱验证服务尚未配置。Email verification is not configured.' : '短信验证服务尚未配置。SMS verification is not configured.');
      if (!await common.checkIpRateLimit(req.ip, `send_${channel}`, channel === 'phone' ? 2 : 4)) throw common.fail(429, 'rate_limited', '发送请求过于频繁，请稍后重试。');
      const backup = defaultKind === 'backup_email';
      const purpose = req.body?.purpose ?? (registered ? 'login' : backup ? 'bind' : 'register');
      if (!(registered ? ['login', 'reset', 'security'] : backup ? ['bind', 'security'] : ['register']).includes(purpose)) throw common.fail(400, 'invalid_purpose', '验证码用途无效。');
      const kind = purpose === 'security' ? (backup ? 'backup_email_security' : `${channel}_security`) : registered && purpose === 'reset' ? `${channel}_reset` : defaultKind;
      const session = purpose === 'security' || backup ? await common.requireSession(req) : null;
      const target = purpose === 'security' ? (backup ? common.normalizeEmail(session.user.backup_email) : channel === 'email' ? common.normalizeEmail(session.user.email) : common.normalizePhone(session.user.phone_country_code, session.user.phone))
        : channel === 'email' ? common.normalizeEmail(req.body?.email) : common.normalizePhone(req.body?.phone_country_code, req.body?.phone);
      if (!target) throw common.fail(400, 'invalid_contact', '请填写有效邮箱或完整国际电话号码。');
      if (!await common.consumeCaptchaToken(req, req.body?.captcha_token)) throw common.fail(400, 'captcha_invalid', '请重新完成人机验证。');
      // A contact-scoped NX cooldown prevents concurrent sends through different
      // purposes. Keys contain only digests, never email addresses or phones.
      const digest = crypto.createHash('sha256').update(target).digest('hex');
      const claim = await common.redisClient.set(`account:v2:send:${channel}:${digest}`, crypto.randomBytes(16).toString('hex'), { NX: true, EX: 60 });
      if (claim !== 'OK') throw common.fail(429, 'delivery_cooldown', '请等待一分钟后再获取验证码。');
      if (!backup && purpose !== 'security') {
        const parts = channel === 'phone' ? common.phoneParts('', target) : null;
        const [users] = channel === 'email' ? await common.dbPool.execute('SELECT id, status FROM users WHERE email = ? LIMIT 1', [target])
          : await common.dbPool.execute('SELECT id, status FROM users WHERE phone = ? AND phone_country_code = ? LIMIT 1', [parts.nationalNumber, parts.countryCode]);
        // Use the same HTTP response for ineligible, nonexistent and inactive
        // accounts; no OTP is persisted or sent for an ineligible account.
        const eligible = registered ? users.length === 1 && Number(users[0].status) === 1 : users.length === 0;
        if (!eligible) return res.json({ success: true, message: publicMessage, data: { expires_in: 300, retry_after: 60 } });
        if (registered) {
          const [restrictions] = await common.dbPool.execute('SELECT restriction_type FROM account_restrictions WHERE user_id = ? AND status = 1 AND (expire_at IS NULL OR expire_at > ?)', [users[0].id, Math.floor((common.clock || Date.now)() / 1000)]);
          if (restrictions.some(item => item.restriction_type === 'login' || item.restriction_type === 'all')) return res.json({ success: true, message: publicMessage, data: { expires_in: 300, retry_after: 60 } });
        }
      }
      const code = crypto.randomInt(100000, 1000000).toString();
      try {
        await common.redisClient.del(common.codeKey(kind, target));
        if (channel === 'email') await delivery.sendEmailCode(target, code); else await delivery.sendSms(target, code);
        // Keep old OTPs unusable on sender failure. Only a confirmed provider
        // acceptance produces a fresh code; no test/stub sender exists here.
        await common.storeCode(kind, target, code, 300);
      } catch {
        throw common.fail(503, 'delivery_failed', '无法确认验证码发送成功，请稍后重试。Verification delivery could not be confirmed.');
      }
      return res.json({ success: true, message: publicMessage, data: { expires_in: 300, retry_after: 60 } });
    }));
  }
  return router;
}

module.exports = { createSenderRouter, routes };
