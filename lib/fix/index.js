'use strict';

const runner = require('../runner');
const resetOverwrittenLabOrders = require('./resetOverwrittenLabOrders');
const updateLabReorderRequests = require('./updateLabReorderRequests');
const updateLabOrders = require('./updateLabOrders');
const logRemainingLabOrders = require('./logRemainingLabOrders');

module.exports = () =>
  runner(async (isDryRun, trx) => {
    await resetOverwrittenLabOrders(isDryRun, trx);
    const reorderRequestUpdatesToLog = await updateLabReorderRequests(isDryRun, trx);
    await updateLabOrders(isDryRun, trx, reorderRequestUpdatesToLog);
    await logRemainingLabOrders(isDryRun, trx);
  });
