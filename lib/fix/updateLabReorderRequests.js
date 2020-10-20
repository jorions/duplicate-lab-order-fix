'use strict';

const knex = require('../knex');
const getFlag = require('../getFlag');
const getSubSortedTimelines = require('../getSubSortedTimelines');

const getUpdatedOriginalLabOrderIds = async trx => {
  // Get all Reorders associated with Orders that do NOT have a NULL LabKitReference.
  // A NULL LabKitReference means that the Reorder was created before we even
  // received a status datafeed for the originalOrder. That would mean the Reorder either
  // got created < 1 day after the original Order, or the Order was rejected by CoreMedica.
  // In either case, that is the end of the line for the given Order as it will then
  // be replaced by a new one, so there is no need to try to update its Reorder request.
  const allLabReorders = await knex('LabReorderRequest as lrr')
    .select('lrr.originalLabOrderId', 'lrr.labReorderRequestId', 'lo.labKitReference')
    .leftJoin('LabOrder as lo', 'lo.LabOrderId', 'lrr.OriginalLabOrderId')
    .whereNotNull('lo.LabKitReference')
    .transacting(trx);
  const allLabOrdersWithReorders = await knex('LabOrder')
    .select('labOrderId', 'labKitReference', 'createdDate')
    .whereIn(
      'labKitReference',
      allLabReorders.map(({ labKitReference }) => labKitReference),
    )
    .transacting(trx);

  const mostRecentLabOrders = {};
  allLabOrdersWithReorders.forEach(({ labOrderId, labKitReference, createdDate }) => {
    const order = mostRecentLabOrders[labKitReference];
    mostRecentLabOrders[labKitReference] =
      (order && order.createdDate < createdDate) || !order ? { labOrderId, createdDate } : order;
  });

  const updatedOriginalLabOrderIds = {};
  allLabReorders.forEach(
    ({ labReorderRequestId, originalLabOrderId: oldOriginalLabOrderId, labKitReference }) => {
      if (!mostRecentLabOrders[labKitReference])
        throw new Error(
          `LabReorderRequest ${labReorderRequestId} does not have a matching LabOrder with LabKitReference ${labKitReference}`,
        );

      updatedOriginalLabOrderIds[labReorderRequestId] = {
        updatedOriginalLabOrderId: mostRecentLabOrders[labKitReference].labOrderId,
        oldOriginalLabOrderId,
      };
    },
  );

  return updatedOriginalLabOrderIds;
};

const getUpdatedNewLabOrderIds = async trx => {
  const timelines = await getSubSortedTimelines(trx);

  const lrrsToLog = getFlag('lrr', lrrList => {
    const map = {};
    if (!lrrList) return map;
    lrrList.split(',').forEach(lrrId => {
      map[lrrId] = true;
    });
    return map;
  });

  // Iterate over the timeline for each Registration to determine the proper NewLabOrderId
  // we should associate with each Lab Reorder Request. As we move down the timeline,
  // if the next event after a Lab Reorder Request is:
  //   - Another Lab Reorder Request, don't update it because its NewLabOrderId should not change.
  //   - A Lab Order, continue moving down in time until the last Lab Order before another Reorder.
  //     That LabOrderId should be used as the NewLabOrderId for the Reorder.
  const updatedNewLabOrderIds = {};
  Object.entries(timelines).forEach(([patientRegistrationId, timeline]) => {
    const evtsToLog = timeline.filter(({ labReorderRequestId }) => lrrsToLog[labReorderRequestId]);
    if (evtsToLog.length) {
      console.log('=====');
      console.log(
        `Logging Timeline for Lab Reorder Request${
          evtsToLog.length === 1 ? '' : 's'
        } ${evtsToLog.map(({ labReorderRequestId }) => labReorderRequestId).join(', ')}:`,
      );
      console.log(timeline);
      console.log('=====');
      console.log();
    }
    timeline.forEach((evt, idx) => {
      if (!evt.isReorder) return;

      const futureEvents = timeline.slice(idx + 1);
      const { labReorderRequestId, newLabOrderId, labKitReference } = evt;

      // If the last thing that happened is a reorder then we can't update the NewLabOrderId.
      // In this case the NewLabOrderId should be NULL, which should have been
      // filtered out in our initial query. As such, this is an unexpected condition
      // and we should skip this patient to avoid an unknown state
      if (!futureEvents.length) {
        console.log(
          `ALERT: Lab Reorder Request ${labReorderRequestId} seems to be the last event for ` +
            `Patient Registration ${patientRegistrationId}, yet it has a NewLabOrderId ${evt.newLabOrderId}.`,
        );
        let atLeastOneUpdate = false;
        timeline.forEach(innerEvt => {
          if (!innerEvt.isReorder) return;
          const { labReorderRequestId: lrrId } = innerEvt;
          if (lrrId === labReorderRequestId) {
            if (!atLeastOneUpdate)
              console.log(
                'This was the only Lab Reorder Request for the Patient Registration, so there were no planned updates for its NewLabOrderId.',
              );
            return; // No need to log this one because we would not be updating it
          }
          if (!atLeastOneUpdate) {
            console.log('We will not apply the following changes for this Patient Registration:');
            atLeastOneUpdate = true;
          }
          console.log({
            labReorderRequestId: lrrId,
            newLabOrderId: {
              old: updatedNewLabOrderIds[lrrId].oldNewLabOrderId,
              new: updatedNewLabOrderIds[lrrId].updatedNewLabOrderId,
            },
          });
          delete updatedNewLabOrderIds[lrrId];
        });
        return;
      }

      // Set the NewLabOrderId for the given Reorder Request to the LabOrderId of the
      // newest Lab Order that has the same LabKitReference as the Lab Order created by the
      // Reorder Request.
      //
      // If there are no newer Lab Orders, or the Lab Order associated to the existing
      // NewLabOrderId has a LabKitReference of NULL, continue to use the existing NewLabOrderId.
      //
      // If there are no updates to the OriginalLabOrderId, nothing should be changed
      // for the Lab Reorder Request so it will not get persisted, and will get logged
      // as a skipped Reorder Request instead.
      const futureLabOrdersWithMatchingLabOrderId =
        labKitReference === null
          ? []
          : futureEvents.filter(
              futureEvt => !futureEvt.isReorder && futureEvt.labKitReference === labKitReference,
            );

      const newestLabOrderWithMatchingLabOrderId =
        futureLabOrdersWithMatchingLabOrderId[futureLabOrdersWithMatchingLabOrderId.length - 1];

      updatedNewLabOrderIds[labReorderRequestId] = {
        updatedNewLabOrderId: newestLabOrderWithMatchingLabOrderId
          ? newestLabOrderWithMatchingLabOrderId.labOrderId
          : newLabOrderId,
        oldNewLabOrderId: newLabOrderId,
      };
    });
  });

  return updatedNewLabOrderIds;
};

const parseLabOrderUpdates = (updatedOriginalLabOrderIds, updatedNewLabOrderIds) => {
  const allData = {};
  Object.entries(updatedOriginalLabOrderIds).forEach(
    ([labReorderRequestId, { updatedOriginalLabOrderId, oldOriginalLabOrderId }]) => {
      allData[labReorderRequestId] = { updatedOriginalLabOrderId, oldOriginalLabOrderId };
    },
  );
  Object.entries(updatedNewLabOrderIds).forEach(
    ([labReorderRequestId, { updatedNewLabOrderId, oldNewLabOrderId }]) => {
      allData[labReorderRequestId] = {
        ...allData[labReorderRequestId],
        updatedNewLabOrderId,
        oldNewLabOrderId,
      };
    },
  );

  const updatesToLog = [];
  const skipsToLog = [];
  const updatesToStore = [];

  Object.entries(allData).forEach(
    ([
      labReorderRequestId,
      { updatedOriginalLabOrderId, oldOriginalLabOrderId, updatedNewLabOrderId, oldNewLabOrderId },
    ]) => {
      const skipOriginalLabOrderIdUpdate =
        (updatedOriginalLabOrderId && updatedOriginalLabOrderId === oldOriginalLabOrderId) ||
        !updatedOriginalLabOrderId;
      const skipNewLabOrderIdUpdate =
        (updatedNewLabOrderId && updatedNewLabOrderId === oldNewLabOrderId) ||
        !updatedNewLabOrderId;

      if (skipOriginalLabOrderIdUpdate && skipNewLabOrderIdUpdate) {
        skipsToLog.push(labReorderRequestId);
        return;
      }

      const updateToLog = { labReorderRequestId: Number(labReorderRequestId) };
      const updateToStore = { labReorderRequestId: Number(labReorderRequestId) };
      if (!skipOriginalLabOrderIdUpdate) {
        updateToLog.originalLabOrderId = {
          old: oldOriginalLabOrderId,
          new: updatedOriginalLabOrderId,
        };
        updateToStore.originalLabOrderId = updatedOriginalLabOrderId;
      }
      if (!skipNewLabOrderIdUpdate) {
        updateToLog.newLabOrderId = { old: oldNewLabOrderId, new: updatedNewLabOrderId };
        updateToStore.newLabOrderId = updatedNewLabOrderId;
      }

      updatesToLog.push(updateToLog);
      updatesToStore.push(updateToStore);
    },
  );

  return { updatesToLog, skipsToLog, updatesToStore };
};

module.exports = async (isDryRun, trx) => {
  console.log('========== Updating Lab Reorder Requests =========\n');

  const updatedOriginalLabOrderIds = await getUpdatedOriginalLabOrderIds(trx);
  const updatedNewLabOrderIds = await getUpdatedNewLabOrderIds(trx);
  const { updatesToLog, skipsToLog, updatesToStore } = parseLabOrderUpdates(
    updatedOriginalLabOrderIds,
    updatedNewLabOrderIds,
  );

  console.log(
    `${isDryRun ? 'We would update' : 'Updating'} ${
      updatesToLog.length
    } Lab Reorder Requests with the following changes:\n`,
  );
  updatesToLog.forEach(update => console.log(update));
  console.log();

  if (skipsToLog.length) {
    console.log(
      `${isDryRun ? 'We would skip' : 'Skipping'} the following ${
        skipsToLog.length
      } Lab Reorder Requests:\n`,
    );
    console.log(skipsToLog.join(', '));
    console.log();
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const { labReorderRequestId, ...data } of updatesToStore) {
    // eslint-disable-next-line no-await-in-loop
    const lrr = await knex('LabReorderRequest')
      .first('originalLabOrderId', 'newLabOrderId')
      .where('LabReorderRequestId', labReorderRequestId);

    if (
      data.originalLabOrderId &&
      data.originalLabOrderId === lrr.newLabOrderId &&
      !data.newLabOrderId
    )
      throw new Error(
        `The Lab Reorder Request ${labReorderRequestId} was going to have its OriginalLabOrderId updated to ${data.originalLabOrderId} but that is the same as its current NewLabOrderId`,
      );
    if (
      data.newLabOrderId &&
      data.newLabOrderId === lrr.originalLabOrderId &&
      !data.originalLabOrderId
    )
      throw new Error(
        `The Lab Reorder Request ${labReorderRequestId} was going to have its NewLabOrderId updated to ${data.newLabOrderId} but that is the same as its current OriginalLabOrderId`,
      );
    // eslint-disable-next-line no-await-in-loop
    await knex('LabReorderRequest')
      .update(data)
      .where('LabReorderRequestId', labReorderRequestId)
      .transacting(trx);
  }

  return updatesToLog;
};
