'use strict';

const knex = require('../knex');

// TODO: If LabKitReference = NULL the solution is kind of involved to determine the next
// step so find out if this is something we need to account for. One potential solution
// is to look at all Lab Orders for that Patient Registration, and:
//   If they have no other newer Lab Orders, we leave it alone
//   If they have a newer Lab Order that...
//     Has a LabKitReference and...
//       Was created before a subsequent Lab Reorder Request, we merge them
//       Was not created before a subsequent Lab Reorder Request, we leave it alone
//     Does not have a LabKitReference, we leave it alone
const getRelevantLabOrders = async () => {
  // Get all Lab Orders with > 1 row of the same LabKitReference
  const everyLabOrderInDB = await knex('LabOrder')
    .select(['labKitReference', knex.raw('COUNT(*) AS labOrderCount')])
    .groupBy('LabKitReference')
    .whereNotNull('LabKitReference');
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
    );

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

  // Build the array of Lab Orders to update by collapsing the newest data into the oldest
  // Build the array of Lab Orders to delete using all but the newest Lab Order for each LabKitReference
  const labOrderUpdates = [];
  const labOrderIdsToDelete = [];
  Object.values(labOrderMap).forEach(labOrders => {
    const newestLabOrder = labOrders[0];
    const allButNewestLabOrder = labOrders.slice(1);
    const updateData = {};

    allButNewestLabOrder.forEach(({ homeKitDeliveredDate, homeKitReturnedDate }) => {
      if (
        !newestLabOrder.homeKitDeliveredDate &&
        !updateData.homeKitDeliveredDate &&
        homeKitDeliveredDate
      )
        updateData.homeKitDeliveredDate = homeKitDeliveredDate;
      if (
        !newestLabOrder.homeKitReturnedDate &&
        !updateData.homeKitReturnedDate &&
        homeKitReturnedDate
      )
        updateData.homeKitReturnedDate = homeKitReturnedDate;
    });

    if (Object.keys(updateData).length)
      labOrderUpdates.push({
        labOrderId: newestLabOrder.labOrderId,
        updatedDate: knex.raw('SYSUTCDATETIME()'),
        ...updateData,
      });
    labOrderIdsToDelete.push(...allButNewestLabOrder.map(({ labOrderId }) => labOrderId));
  });

  return { labOrderUpdates, labOrderIdsToDelete };
};

module.exports = async (isDryRun, trx) => {
  console.log('========== Updating Newest Instance of Each Lab Order =========\n');

  const { labOrderUpdates, labOrderIdsToDelete } = await getRelevantLabOrders();

  console.log(
    `${isDryRun ? 'We would update' : 'Updating'} ${
      labOrderUpdates.length
    } Lab Orders with the following data:\n`,
  );
  labOrderUpdates.forEach(({ updatedDate, ...data }) => {
    console.log({
      ...data,
      updatedDate: 'SYSUTCDATETIME()',
    });
  });
  console.log();

  console.log('========== Deleting Older Instances of Each Lab Order =========\n');

  if (!isDryRun) {
    // eslint-disable-next-line no-restricted-syntax
    for (const { labOrderId, ...data } of labOrderUpdates) {
      // eslint-disable-next-line no-await-in-loop
      await knex('LabOrder')
        .update(data)
        .where('LabOrderId', labOrderId)
        .transacting(trx);
    }
  }

  console.log(
    `${isDryRun ? 'We would delete' : 'Deleting'} the following ${
      labOrderIdsToDelete.length
    } Lab Orders:\n`,
  );
  console.log(labOrderIdsToDelete.join(', '));
  console.log();

  if (!isDryRun) {
    await knex('LabOrder')
      .delete()
      .whereIn('LabOrderId', labOrderIdsToDelete)
      .transacting(trx);
  }
};
