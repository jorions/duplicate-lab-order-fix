'use strict';

const knex = require('./knex');

const isDryRun = process.env.DRY_RUN === 'true';

const SKIP = 'skip';

module.exports = async cb => {
  if (isDryRun) console.log('##################### DRY RUN #####################\n');
  try {
    await knex.transaction(async trx => {
      await cb(isDryRun, trx);
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
