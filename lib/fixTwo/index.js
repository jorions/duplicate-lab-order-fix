'use strict';

const runner = require('../runner');
const updateLabReorderRequestsAndDeleteOldLabOrders = require('./updateLabReorderRequestsAndDeleteOldLabOrders');
const logRemainingLabReorderRequests = require('./logRemainingLabReorderRequests');

module.exports = () =>
  runner(async (isDryRun, trx) => {
    await updateLabReorderRequestsAndDeleteOldLabOrders(isDryRun, trx);
    await logRemainingLabReorderRequests(isDryRun, trx);
  });
