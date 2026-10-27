'use strict';

// Compatibility helper: a configured provider must actually accept delivery.
const { createDelivery } = require('../account/sender/sender.cjs');
const { readConfig } = require('../account/common/common.cjs');
async function sendEmailCode(email, code) { return createDelivery(readConfig()).sendEmailCode(email, code); }
module.exports = { sendEmailCode };
