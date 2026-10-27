'use strict';

const { createDelivery } = require('../account/sender/sender.cjs');
const { readConfig, normalizePhone } = require('../account/common/common.cjs');
async function sendSms(countryCode, phone, code) {
  const target = normalizePhone(countryCode, phone);
  if (!target) throw new Error('A valid international phone number is required.');
  return createDelivery(readConfig()).sendSms(target, code);
}
module.exports = { sendSms };
