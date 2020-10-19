'use strict';

const knex = require('../knex');

module.exports = async (isDryRun, trx) => {
  console.log('========== Summary of Remaining Lab Orders =========\n');

  const remainingLabOrders = await knex('LabOrder as lo')
    .select('lo.labOrderId')
    .leftJoin('LabReorderRequest as lrr', 'lrr.OriginalLabOrderId', 'lo.LabOrderId')
    .whereNull('LabKitReference')
    .whereNull('lrr.OriginalLabOrderId')
    .transacting(trx);

  console.log(
    `${isDryRun ? 'We would leave' : 'Leaving'} the following ${
      remainingLabOrders.length
    } Lab Orders where LabKitReference = NULL and no LabReorderRequest has a matching OriginalLabOrderId:\n`,
  );
  console.log(remainingLabOrders.map(({ labOrderId }) => labOrderId).join(', '));
  console.log();
};
