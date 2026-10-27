'use strict';

const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const phonePattern = /^\+[1-9]\d{6,14}$/;
function unavailable() { const error = new Error('Verification delivery is not configured.'); error.status = 503; error.code = 'delivery_unavailable'; return error; }
function failed() { const error = new Error('Verification delivery could not be confirmed.'); error.status = 503; error.code = 'delivery_failed'; return error; }

/** Credentials stay server-side. No mock/log sender is ever exposed as enabled. */
function createDelivery(config = {}, dependencies = {}) {
  const env = config.env || process.env;
  const smtpPort = Number(env.ACCOUNT_SMTP_PORT || 587);
  const emailConfigured = Boolean(env.ACCOUNT_SMTP_HOST && env.ACCOUNT_SMTP_USER && env.ACCOUNT_SMTP_PASSWORD && emailPattern.test(env.ACCOUNT_EMAIL_FROM || '') && Number.isInteger(smtpPort) && smtpPort > 0 && smtpPort <= 65535);
  const sid = env.TWILIO_ACCOUNT_SID || '';
  const messagingSid = env.TWILIO_MESSAGING_SERVICE_SID || '';
  const smsConfigured = env.ACCOUNT_SMS_PROVIDER === 'twilio' && /^AC[a-fA-F0-9]{32}$/.test(sid) && /^[a-fA-F0-9]{32}$/.test(env.TWILIO_AUTH_TOKEN || '') && (phonePattern.test(env.TWILIO_FROM_NUMBER || '') || /^MG[a-fA-F0-9]{32}$/.test(messagingSid));
  let transport;
  return {
    capabilities: Object.freeze({ email: emailConfigured, sms: Boolean(smsConfigured) }),
    async sendEmailCode(email, code) {
      if (!emailConfigured) throw unavailable();
      if (!emailPattern.test(email) || /[\r\n]/.test(email) || !/^\d{6}$/.test(code)) throw failed();
      try {
        if (!transport) {
          const createTransport = dependencies.createTransport || require('nodemailer').createTransport;
          const secure = smtpPort === 465 || env.ACCOUNT_SMTP_SECURE === 'true';
          transport = createTransport({ host: env.ACCOUNT_SMTP_HOST, port: smtpPort, secure, requireTLS: !secure,
            auth: { user: env.ACCOUNT_SMTP_USER, pass: env.ACCOUNT_SMTP_PASSWORD }, tls: { minVersion: 'TLSv1.2' },
            connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, logger: false, debug: false,
            disableFileAccess: true, disableUrlAccess: true });
        }
        const result = await transport.sendMail({ from: env.ACCOUNT_EMAIL_FROM, to: email,
          subject: 'Your verification code / 账号验证码', text: `Your verification code is ${code}. It expires in 5 minutes. If you did not request it, ignore this email.\n您的验证码是 ${code}，5 分钟内有效。如非本人操作，请忽略。`,
          disableFileAccess: true, disableUrlAccess: true });
        if (!Array.isArray(result?.accepted) || !result.accepted.some(address => String(address).toLowerCase() === email.toLowerCase())) throw failed();
      } catch { throw failed(); }
    },
    async sendSms(phone, code) {
      if (!smsConfigured) throw unavailable();
      if (!phonePattern.test(phone) || !/^\d{6}$/.test(code)) throw failed();
      try {
        const body = new URLSearchParams({ To: phone, Body: `Your verification code is ${code}. It expires in 5 minutes. Do not share this code.` });
        if (messagingSid) body.set('MessagingServiceSid', messagingSid); else body.set('From', env.TWILIO_FROM_NUMBER);
        const request = dependencies.fetch || fetch;
        const response = await request(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', redirect: 'error',
          headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body, signal: AbortSignal.timeout(15000) });
        const value = await response.json();
        if (!response.ok || !/^SM[a-fA-F0-9]{32}$/.test(value?.sid || '') || !['accepted', 'queued', 'sending', 'sent', 'delivered'].includes(value?.status) || value?.error_code) throw failed();
      } catch { throw failed(); }
    },
  };
}

module.exports = { createDelivery };
