'use strict';

// Compatibility path only. The supplied modular account system is canonical.
// Importing this file creates no MySQL/Redis connections and opens no listener.
const account = require('../account/api_server.cjs');
module.exports = account;
if (require.main === module) account.runCLI();
