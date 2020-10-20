'use strict';

const knex = require('../knex');

const isDryRun = process.env.DRY_RUN === 'true';

const resetLabOrderLabKitReferences = require('./resetLabOrderLabKitReferences');
const updateLabReorderRequests = require('./updateLabReorderRequests');
const updateLabOrders = require('./updateLabOrders');
const logRemainingLabOrders = require('./logRemainingLabOrders');

const SKIP = 'skip';

module.exports = async () => {
  if (isDryRun) console.log('##################### DRY RUN #####################\n');
  try {
    await knex.transaction(async trx => {
      await resetLabOrderLabKitReferences(isDryRun, trx);
      const reorderRequestUpdatesToLog = await updateLabReorderRequests(isDryRun, trx);
      await updateLabOrders(isDryRun, trx, reorderRequestUpdatesToLog);
      await logRemainingLabOrders(isDryRun, trx);
      if (isDryRun) {
        console.info('Complete!');
        const err = new Error();
        err.code = SKIP;
        throw err;
      }
    });
    console.info('Complete!');
  } catch (err) {
    if (err.code !== SKIP) console.error(err);
  } finally {
    process.exit();
  }
};
