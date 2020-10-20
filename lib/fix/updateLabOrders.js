'use strict';

const knex = require('../knex');
const getLabOrderMap = require('./getLabOrderMap');

// TODO: If LabKitReference = NULL the solution is kind of involved to determine the next
// step so find out if this is something we need to account for. One potential solution
// is to look at all Lab Orders for that Patient Registration, and:
//   If they have no other newer Lab Orders, we leave it alone
//   If they have a newer Lab Order that...
//     Has a LabKitReference and...
//       Was created before a subsequent Lab Reorder Request, we merge them
//       Was not created before a subsequent Lab Reorder Request, we leave it alone
//     Does not have a LabKitReference, we leave it alone
const getNewestLabOrdersToUpdateAndLabOrdersToDelete = async trx => {
  // Run this a second time after we already did it in getLabOrdersToSetBackToNull so that our
  // query takes into account the newly-NULLed LabKitReferences
  const labOrderMap = await getLabOrderMap(trx);

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

/*
reorderRequestUpdatesToLog = [
  {
    labReorderRequestId,
    originalLabOrderId: { old, new } || undefined,
    newLabOrderId: { old, new } || undefined
  }
]
*/
module.exports = async (isDryRun, trx, reorderRequestUpdatesToLog) => {
  console.log('========== Updating Newest Instance of Each Lab Order =========\n');
  const {
    labOrderUpdates,
    labOrderIdsToDelete,
  } = await getNewestLabOrdersToUpdateAndLabOrdersToDelete(trx);

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

  // eslint-disable-next-line no-restricted-syntax
  for (const { labOrderId, ...data } of labOrderUpdates) {
    // eslint-disable-next-line no-await-in-loop
    await knex('LabOrder')
      .update(data)
      .where('LabOrderId', labOrderId)
      .transacting(trx);
  }

  console.log('========== Deleting Older Instances of Each Lab Order =========\n');

  console.log(
    `${isDryRun ? 'We would delete' : 'Deleting'} the following ${
      labOrderIdsToDelete.length
    } Lab Orders:\n`,
  );
  console.log(labOrderIdsToDelete.join(', '));
  console.log();

  // Compare the list of LabReorderRequest.New/OriginalLabOrderId changes with the
  // list of Lab Orders to be deleted, to make sure that every New/OriginalLabOrderId
  // that we are overwriting is also tagged for deletion.
  const deletionMap = {};
  labOrderIdsToDelete.forEach(id => {
    deletionMap[id] = true;
  });
  const missingUpdates = reorderRequestUpdatesToLog.filter(
    ({ originalLabOrderId, newLabOrderId }) =>
      (originalLabOrderId && !deletionMap[originalLabOrderId.old]) ||
      (newLabOrderId && !deletionMap[newLabOrderId.old]),
  );
  if (missingUpdates.length) {
    console.log(
      'Found the following Lab Reorder Request updates that should result in Lab Order deletions, but are not.',
    );
    missingUpdates.forEach(({ labReorderRequestId, originalLabOrderId, newLabOrderId }) => {
      const dataToLog = { labReorderRequestId };
      if (originalLabOrderId && !deletionMap[originalLabOrderId.old])
        dataToLog.originalLabOrderId = originalLabOrderId;
      if (newLabOrderId && !deletionMap[newLabOrderId.old]) dataToLog.newLabOrderId = newLabOrderId;
      console.log(dataToLog);
    });
    throw new Error('Exiting because of these missing deletions');
  }

  await knex('LabOrder')
    .delete()
    .whereIn('LabOrderId', labOrderIdsToDelete)
    .transacting(trx);
};
