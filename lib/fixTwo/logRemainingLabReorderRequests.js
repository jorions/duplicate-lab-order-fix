'use strict';

const knex = require('../knex');

module.exports = async (isDryRun, trx) => {
  console.log('========== Summary of Remaining Lab Reorder Requests =========\n');

  const remainingLabReorderRequests = await knex('LabReorderRequest as lrr')
    .select('lrr.labReorderRequestId', 'lo.labOrderId')
    .leftJoin('LabOrder as lo', 'lo.LabOrderId', 'lrr.NewLabOrderId')
    .whereNull('lo.labKitReference')
    .whereNotNull('lo.LabOrderId')
    .transacting(trx);

  console.log(
    `After our changes we ${isDryRun ? 'would ' : ''}have ${
      remainingLabReorderRequests.length
    } Lab Reorder Requests which generated Lab Orders that still have NULL LabKitReferences:\n`,
  );
  remainingLabReorderRequests.forEach(({ labReorderRequestId, labOrderId }) => {
    console.log({ labReorderRequestId, labOrderId });
  });
  console.log();
};
