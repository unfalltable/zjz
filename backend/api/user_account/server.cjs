'use strict';

// This Node service is separate from the storefront's Cloudflare Worker.
async function start() {
  const port = Number(process.env.ACCOUNT_PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ACCOUNT_PORT must be an integer between 1 and 65535.');
  }
  for (const key of ['MYSQL_USER', 'MYSQL_DATABASE']) {
    if (!process.env[key]?.trim()) throw new Error(`Configure ${key} in backend/api/.env.`);
  }

  const account = require('./user_account_api.js');
  try {
    await account.redisReady;
    await account.query('SELECT 1');
    const host = process.env.ACCOUNT_HOST || '127.0.0.1';
    return await new Promise((resolve, reject) => {
      const server = account.app.listen(port, host, () => {
        console.info(`[account-api] Listening on ${host}:${port}`);
        resolve(server);
      });
      server.once('error', reject);
    });
  } catch (error) {
    if (account.redisClient.isOpen) account.redisClient.destroy();
    await account.end();
    throw error;
  }
}

module.exports = { start };

if (require.main === module) {
  start().catch(() => {
    // Do not dump driver errors: they can contain credentials or account data.
    console.error('[account-api] Startup failed. Check port, MySQL and Redis configuration.');
    process.exitCode = 1;
  });
}
