'use strict';

const knex = require('../knex');

module.exports = async trx => {
  // Get all Lab Orders with > 1 row of the same LabKitReference
  const everyLabOrderInDB = await knex('LabOrder')
    .select(['labKitReference', knex.raw('COUNT(*) AS labOrderCount')])
    .groupBy('LabKitReference')
    .whereNotNull('LabKitReference')
    .transacting(trx);
  // TODO: Can't figure out how to only select Lab Orders where labOrderCount > 1
  const allLabOrders = everyLabOrderInDB.filter(({ labOrderCount }) => labOrderCount > 1);

  // Get every Lab Order that has its LabKitReference appear more than once
  const relevantLabOrders = await knex('LabOrder')
    .select(
      'labKitReference',
      'createdDate',
      'labOrderId',
      'homeKitDeliveredDate',
      'homeKitReturnedDate',
    )
    .whereIn(
      'LabKitReference',
      allLabOrders.map(({ labKitReference }) => labKitReference),
    )
    .transacting(trx);

  // Build a map of Lab Orders grouped by LabKitReference, and within each LabKitReference
  // sort newest to oldest
  const labOrderMap = {};
  relevantLabOrders.forEach(
    ({ labKitReference, createdDate, labOrderId, homeKitDeliveredDate, homeKitReturnedDate }) => {
      const data = {
        createdDate,
        labOrderId,
        homeKitDeliveredDate,
        homeKitReturnedDate,
      };
      if (labOrderMap[labKitReference]) labOrderMap[labKitReference].push(data);
      else labOrderMap[labKitReference] = [data];
    },
  );
  Object.keys(labOrderMap).forEach(labKitReference => {
    labOrderMap[labKitReference].sort((a, b) => (a.createdDate < b.createdDate ? 1 : -1));
  });

  return labOrderMap;
};
