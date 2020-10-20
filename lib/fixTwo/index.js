'use strict';

const runner = require('../runner');
const updateLabReorderRequestsAndDeleteOldLabOrders = require('./updateLabReorderRequestsAndDeleteOldLabOrders');

module.exports = () =>
  runner(async (isDryRun, trx) => {
    await updateLabReorderRequestsAndDeleteOldLabOrders(isDryRun, trx);
  });
