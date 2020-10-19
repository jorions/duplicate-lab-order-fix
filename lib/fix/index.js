'use strict';

const knex = require('../knex');

const isDryRun = process.env.DRY_RUN === 'true';

const updateLabReorderRequests = require('./updateLabReorderRequests');
const updateLabOrders = require('./updateLabOrders');
const logRemainingLabOrders = require('./logRemainingLabOrders');

module.exports = async () => {
  if (isDryRun) console.log('##################### DRY RUN #####################\n');
  try {
    await knex.transaction(async trx => {
      await updateLabReorderRequests(isDryRun, trx);
      await updateLabOrders(isDryRun, trx);
      await logRemainingLabOrders(isDryRun, trx);
    });
    console.info('Complete!');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
};
