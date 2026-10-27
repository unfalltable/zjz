'use strict';

const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const multer = require('multer');

function createProfileRouter(common) {
  const router = express.Router();
  const { route, fail, config, dbPool, requireSession } = common;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    fileFilter: (_req, file, done) => done(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) });
  async function storage() {
    const directory = config.uploadPath;
    if (!directory || !path.isAbsolute(directory) || path.parse(directory).root === directory) fail(503, 'avatar_storage_not_configured', '头像存储尚未配置。');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || path.resolve(await fs.realpath(directory)) !== path.resolve(directory)) fail(503, 'avatar_storage_invalid', '头像存储不可用。');
    return directory;
  }
  async function quota(directory, addition) {
    const maxFiles = Number(config.env.ACCOUNT_AVATAR_MAX_FILES || 20000), maxBytes = Number(config.env.ACCOUNT_AVATAR_MAX_BYTES || 1073741824);
    if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) fail(503, 'avatar_storage_invalid', '头像存储限额配置无效。');
    let count = 0, bytes = 0;
    for await (const entry of await fs.opendir(directory)) {
      if (!/^[a-f0-9]{32}\.webp$/.test(entry.name)) continue;
      const stat = await fs.lstat(path.join(directory, entry.name));
      if (!stat.isFile() || stat.isSymbolicLink()) fail(503, 'avatar_storage_invalid', '头像存储不可用。');
      count++; bytes += stat.size;
      if (count >= maxFiles || bytes + addition > maxBytes) fail(503, 'avatar_storage_full', '头像存储空间不足，请联系管理员。');
    }
    if (bytes + addition > maxBytes) fail(503, 'avatar_storage_full', '头像存储空间不足，请联系管理员。');
  }
  router.post('/api/account/avatar', async (req, _res, next) => {
    try { req.accountSession = await requireSession(req);
      if (!await common.checkIpRateLimit(req.ip || 'unknown', 'avatar_upload', 10)) fail(429, 'rate_limited', '上传过于频繁，请稍后重试。');
      if (!await common.checkIpRateLimit(req.accountSession.user_id, 'avatar_user', 5)) fail(429, 'rate_limited', '上传过于频繁，请稍后重试。');
      next();
    } catch (error) { next(error); }
  }, (req, res, next) => upload.single('avatar')(req, res, next), route(async (req, res) => {
    const session = req.accountSession;
    if (!req.file) fail(400, 'avatar_invalid', '请选择 5 MB 以内的 JPEG、PNG 或 WebP 图片。');
    const input = req.file.buffer;
    let encoded;
    try { const image = sharp(input, { limitInputPixels: 24_000_000, failOn: 'warning', animated: false });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format) || metadata.format !== ({ 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' })[req.file.mimetype] || !metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || (metadata.pages || 1) !== 1) throw new Error('avatar_format');
      encoded = await image.rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch { fail(400, 'avatar_invalid', '图片损坏、格式不符或尺寸超出限制。'); }
    const directory = await storage();
    await quota(directory, encoded.length);
    const filename = `${crypto.randomBytes(16).toString('hex')}.webp`;
    const url = `/api/account/avatar/files/${filename}`;
    const pathname = path.join(directory, filename);
    await fs.writeFile(pathname, encoded, { flag: 'wx', mode: 0o600 });
    try {
      const [result] = await dbPool.execute('UPDATE users SET avatar_url = ?, updated_at = NOW() WHERE id = ? AND status = 1 AND auth_version = ?', [url, session.user_id, session.auth_version]);
      if (Number(result.affectedRows) !== 1) { await fs.unlink(pathname); fail(409, 'account_changed', '账号已变化，请重新登录后上传。'); }
    } catch (error) {
      // A lost MySQL acknowledgement may follow an accepted update. Delete only
      // this fresh file after a successful read proves it is not referenced.
      try { const [rows] = await dbPool.execute('SELECT avatar_url FROM users WHERE id = ? LIMIT 1', [session.user_id]); if (rows[0]?.avatar_url !== url) await fs.unlink(pathname).catch(() => {}); } catch { /* preserve an uncertain accepted upload */ }
      throw error;
    }
    res.json({ success: true, message: '头像已更新', data: { avatar_url: url } });
  }));
  router.get('/api/account/avatar/files/:filename', route(async (req, res) => {
    if (!/^[a-f0-9]{32}\.webp$/.test(req.params.filename)) fail(404, 'not_found', '图片不存在。');
    let file;
    try { const directory = await storage(); const pathname = path.join(directory, req.params.filename); const stat = await fs.lstat(pathname);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) fail(404, 'not_found', '图片不存在。');
      const handle = await fs.open(pathname, require('node:fs').constants.O_RDONLY | (require('node:fs').constants.O_NOFOLLOW || 0));
      try { file = await handle.readFile(); } finally { await handle.close(); }
    } catch (error) { if (error?.code === 'ENOENT') fail(404, 'not_found', '图片不存在。'); throw error; }
    res.setHeader('Content-Type', 'image/webp'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'public, max-age=86400'); res.send(file);
  }));
  for (const action of ['save', 'get']) router.post(`/api/account/profile/birth/${action}`, route(async (req, res) => {
    if (!config.profileBirthEnabled) fail(404, 'profile_not_enabled', '此资料功能未在购物系统启用。');
    const session = await requireSession(req);
    if (action === 'get') { const [rows] = await dbPool.execute('SELECT gender, birth_date, birth_time, birth_longitude, birth_latitude, default_cast_method FROM user_profiles WHERE user_id = ? LIMIT 1', [session.user_id]); return res.json({ success: true, message: 'ok', data: rows[0] || null }); }
    const { gender, birth_date, birth_time, longitude, latitude } = req.body;
    const date = typeof birth_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(birth_date) ? new Date(`${birth_date}T00:00:00Z`) : null;
    if (!['male', 'female'].includes(gender) || !date || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== birth_date || date > new Date() || typeof birth_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(birth_time)) fail(400, 'profile_invalid', '请检查出生日期和时间。');
    const lon = longitude == null || longitude === '' ? null : Number(longitude), lat = latitude == null || latitude === '' ? null : Number(latitude);
    if ((lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) || (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90))) fail(400, 'profile_invalid', '经纬度超出范围。');
    await dbPool.execute('INSERT INTO user_profiles (user_id, gender, birth_date, birth_time, birth_longitude, birth_latitude, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE gender=VALUES(gender),birth_date=VALUES(birth_date),birth_time=VALUES(birth_time),birth_longitude=VALUES(birth_longitude),birth_latitude=VALUES(birth_latitude),updated_at=NOW()', [session.user_id, gender, birth_date, birth_time, lon, lat]);
    res.json({ success: true, message: '资料已保存' });
  }));
  return router;
}
module.exports = { createProfileRouter };
