'use strict';

const crypto = require('node:crypto');
const express = require('express');
const svgCaptcha = require('svg-captcha');
const sharp = require('sharp');

const CAPTCHA_TTL = 300;
const idPattern = /^[a-f0-9]{32}$/;
const key = (type, id) => `account:v2:captcha:${type}:${id}`;
const ipHash = (req) => crypto.createHash('sha256').update(String(req.ip || '')).digest('hex');

// Comparison, failed-attempt budget and one-time deletion are one Redis operation.
const verifyScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, value = pcall(cjson.decode, raw)
if not ok or value.ipHash ~= ARGV[1] then return 0 end
local accepted = false
if ARGV[3] == 'slider' then
  local supplied = tonumber(ARGV[2])
  local answer = tonumber(value.answer)
  accepted = supplied ~= nil and answer ~= nil and math.abs(supplied - answer) <= 5
else
  accepted = value.answer == ARGV[2]
end
if accepted then redis.call('DEL', KEYS[1]); return 1 end
value.attempts = (value.attempts or 0) + 1
if value.attempts >= 5 then redis.call('DEL', KEYS[1])
else
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl > 0 then redis.call('SET', KEYS[1], cjson.encode(value), 'PX', ttl) end
end
return 0`;

async function consume(common, req, type, id, answer) {
  if (typeof id !== 'string' || !idPattern.test(id)) return false;
  return Number(await common.redisClient.eval(verifyScript, {
    keys: [key(type, id)], arguments: [ipHash(req), String(answer), type],
  })) === 1;
}

async function consumeSlider(common, req, id, raw) {
  const supplied = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,3}(?:\.\d{1,2})?$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(supplied) || supplied < 0 || supplied > 256) return false;
  return consume(common, req, 'slider', id, supplied);
}

async function consumeImage(common, req, id, raw) {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9]{4}$/.test(raw.trim())) return false;
  return consume(common, req, 'image', id, raw.trim().toUpperCase());
}

function createCaptchaRouter(common, dependencies = {}) {
  const router = express.Router();
  const captcha = dependencies.svgCaptcha || svgCaptcha;
  const raster = dependencies.sharp || sharp;
  const random = dependencies.randomBytes || crypto.randomBytes;
  const png = async (svg) => raster(Buffer.from(svg), { limitInputPixels: 1000000 }).png().toBuffer();
  async function limited(req, type) {
    if (!await common.checkIpRateLimit(req.ip, `captcha_${type}`, 20)) throw common.fail(429, 'rate_limited', '验证码请求过于频繁，请稍后重试。');
  }
  async function save(req, type, answer) {
    const id = random(16).toString('hex');
    await common.redisClient.set(key(type, id), JSON.stringify({ answer, ipHash: ipHash(req), attempts: 0 }), { EX: CAPTCHA_TTL });
    return id;
  }
  router.post('/api/account/captcha/image', common.route(async (req, res) => {
    await limited(req, 'image_generate');
    const challenge = captcha.create({ size: 4, ignoreChars: '0o1iIl', noise: 3, color: true, background: '#f2f2f2', width: 160, height: 60 });
    const image = await png(challenge.data);
    const id = await save(req, 'image', challenge.text.toUpperCase());
    res.json({ success: true, message: '图片验证码已生成。', data: { captcha_id: id, image: `data:image/png;base64,${image.toString('base64')}`, expires_in: CAPTCHA_TTL } });
  }));
  router.post('/api/account/captcha/image/verify', common.route(async (req, res) => {
    await limited(req, 'image_verify');
    if (!await consumeImage(common, req, req.body?.captcha_id, req.body?.code ?? req.body?.text)) throw common.fail(400, 'captcha_invalid', '验证码错误、已使用或已过期，请重新获取。');
    const token = await common.setCaptchaToken(req);
    res.json({ success: true, message: '验证码验证成功。', data: { captcha_token: token, expires_in: CAPTCHA_TTL } });
  }));
  router.post('/api/account/captcha/slider', common.route(async (req, res) => {
    await limited(req, 'slider_generate');
    const width = 320, height = 160, size = 64;
    const x = crypto.randomInt(85, width - size - 10), y = crypto.randomInt(10, height - size - 10);
    const color = `hsl(${crypto.randomInt(0, 360)},55%,35%)`;
    const shape = 'M11 11H26A11 11 0 1 1 48 11H53V26A11 11 0 1 0 53 48V53H38A11 11 0 1 1 16 53H11V38A11 11 0 1 0 11 16Z';
    const circles = Array.from({ length: 8 }, () => `<circle cx="${crypto.randomInt(0, width)}" cy="${crypto.randomInt(0, height)}" r="${crypto.randomInt(9, 30)}" fill="#fff" opacity=".15"/>`).join('');
    const background = await png(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/>${circles}<g transform="translate(${x},${y})"><path d="${shape}" fill="#000" opacity=".5" stroke="#fff" stroke-width="2"/></g></svg>`);
    const puzzle = await png(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><path d="${shape}" fill="#f5f5f5" stroke="#fff" stroke-width="2"/></svg>`);
    const id = await save(req, 'slider', x);
    res.json({ success: true, message: '滑动验证码已生成。', data: { captcha_id: id, background: `data:image/png;base64,${background.toString('base64')}`, puzzle: `data:image/png;base64,${puzzle.toString('base64')}`, width, height, puzzle_size: size, puzzle_y: y, expires_in: CAPTCHA_TTL } });
  }));
  router.post('/api/account/captcha/slider/verify', common.route(async (req, res) => {
    await limited(req, 'slider_verify');
    if (!await consumeSlider(common, req, req.body?.captcha_id, req.body?.x)) throw common.fail(400, 'captcha_invalid', '验证码错误、已使用或已过期，请重新获取。');
    const token = await common.setCaptchaToken(req);
    res.json({ success: true, message: '验证码验证成功。', data: { captcha_token: token, expires_in: CAPTCHA_TTL } });
  }));
  return router;
}

module.exports = { createCaptchaRouter, consumeSlider, consumeImage, verifyScript };
