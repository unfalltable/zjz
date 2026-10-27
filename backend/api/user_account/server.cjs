'use strict';

// Existing deployment commands use the same canonical account entry point.
const account = require('../account/api_server.cjs');
module.exports = account;
if (require.main === module) account.runCLI();
