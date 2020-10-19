'use strict';

const knex = require('../knex');

const getUpdatedOriginalLabOrderIds = async () => {
  // Get all Reorders associated with Orders that do NOT have a NULL LabKitReference.
  // A NULL LabKitReference means that the Reorder was created before we even
  // received a status datafeed for the originalOrder. That would mean the Reorder either
  // got created < 1 day after the original Order, or the Order was rejected by CoreMedica.
  // In either case, that is the end of the line for the given Order as it will then
  // be replaced by a new one, so there is no need to try to update its Reorder request.
  const allLabReorders = await knex('LabReorderRequest as lrr')
    .select('lrr.originalLabOrderId', 'lrr.labReorderRequestId', 'lo.labKitReference')
    .leftJoin('LabOrder as lo', 'lo.LabOrderId', 'lrr.OriginalLabOrderId')
    .whereNotNull('lo.LabKitReference');
  const allLabOrdersWithReorders = await knex('LabOrder')
    .select('labOrderId', 'labKitReference', 'createdDate')
    .whereIn(
      'labKitReference',
      allLabReorders.map(({ labKitReference }) => labKitReference),
    );

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

const getUpdatedNewLabOrderIds = async () => {
  // Get all Reorders that generated a new Lab Order
  const allLabReorders = await knex('LabReorderRequest as lrr')
    .select(
      'lrr.newLabOrderId',
      'lrr.labReorderRequestId',
      'lrr.createdDate',
      'lo.labKitReference',
      'lo.patientRegistrationId',
    )
    .leftJoin('LabOrder as lo', 'lo.LabOrderId', 'lrr.NewLabOrderId')
    .whereNotNull('lrr.newLabOrderId');

  // Get all Patient Registrations associated with those Lab Orders
  const allPatientRegistrations = await knex('LabOrder as lo')
    .select('pr.patientRegistrationId')
    .leftJoin('PatientRegistration as pr', 'pr.PatientRegistrationId', 'lo.PatientRegistrationId')
    .whereIn(
      'lo.LabOrderId',
      allLabReorders.map(({ newLabOrderId }) => newLabOrderId),
    );

  // Get all Lab Orders associated with those Patient Registrations
  const allLabOrders = await knex('LabOrder')
    .select('labOrderId', 'patientRegistrationId', 'labKitReference', 'createdDate')
    .whereIn(
      'PatientRegistrationId',
      allPatientRegistrations.map(({ patientRegistrationId }) => patientRegistrationId),
    );

  // Merge the Lab Orders and Lab Reorder Requests for each Patient Registration,
  // building a timeline array for each Registration starting from the oldest event
  // to the newest
  const timelines = {};
  allPatientRegistrations.forEach(({ patientRegistrationId }) => {
    const patientLabOrders = allLabOrders.filter(
      lo => lo.patientRegistrationId === patientRegistrationId,
    );
    const patientLabReorders = allLabReorders
      .filter(lrr => lrr.patientRegistrationId === patientRegistrationId)
      .map(lrr => ({ ...lrr, isReorder: true }));

    const originalTimeline = [...patientLabOrders, ...patientLabReorders].sort((a, b) =>
      a.createdDate > b.createdDate ? 1 : -1,
    );

    // Handle the situation where we continue to receive updates for earlier Lab Orders
    // even after we have a newer Lab Order for the given PatientRegistrationId.
    // Solve by subsorting the timeline to group all Lab Orders of a given LabKitReference together
    // Ex: originalTimeline = [1,1,Reorder,2,2,1,2,Reorder,2,3,3,1]
    //   final returned arr = [1,1,1,1,Reorder,2,2,2,2,Reorder,3,3]
    const subSortedTimeline = []; // [{ labKitReference, events: [orderEvt, ...] }, reorderEvt or labOrderEvtWithNullLabKitReference, ...]
    originalTimeline.forEach(evt => {
      if (evt.isReorder || !evt.labKitReference) {
        subSortedTimeline.push(evt);
        return;
      }

      const order = subSortedTimeline.find(
        ({ isReorder, labKitReference }) => !isReorder && evt.labKitReference === labKitReference,
      );
      if (order) order.events.push(evt);
      else subSortedTimeline.push({ labKitReference: evt.labKitReference, events: [evt] });
    });

    // Flatten the nested array to a flat list of Lab Orders and Lab Reorder Requests
    timelines[patientRegistrationId] = subSortedTimeline
      .map(orderEvtListOrEvt => orderEvtListOrEvt.events || orderEvtListOrEvt)
      .flat();
  });

  // Iterate over the timeline for each Registration to determine the proper NewLabOrderId
  // we should associate with each Lab Reorder Request. As we move down the timeline,
  // if the next event after a Lab Reorder Request is:
  //   - Another Lab Reorder Request, don't update it because its NewLabOrderId should not change.
  //   - A Lab Order, continue moving down in time until the last Lab Order before another Reorder.
  //     That LabOrderId should be used as the NewLabOrderId for the Reorder.
  const updatedNewLabOrderIds = {};
  Object.entries(timelines).forEach(([patientRegistrationId, timeline]) => {
    timeline.forEach((evt, idx) => {
      if (!evt.isReorder) return;

      const futureEvents = timeline.slice(idx + 1);
      const { labReorderRequestId, newLabOrderId } = evt;

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

      let updatedNewLabOrderId;
      const nextReorderIdx = futureEvents.findIndex(({ isReorder }) => isReorder);
      // When there are no more Reorders use the last Lab Order Id
      if (nextReorderIdx === -1) updatedNewLabOrderId = timeline[timeline.length - 1].labOrderId;
      // When the immediate next event is another Reorder, don't change anything
      else if (nextReorderIdx === 0) updatedNewLabOrderId = newLabOrderId;
      // When there is another Reorder later, use the last Lab Order Id before that Reorder
      else updatedNewLabOrderId = futureEvents[nextReorderIdx - 1].labOrderId;

      updatedNewLabOrderIds[labReorderRequestId] = {
        updatedNewLabOrderId,
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

      const updateToLog = { labReorderRequestId };
      const updateToStore = { labReorderRequestId, updatedDate: knex.raw('SYSUTCDATETIME()') };
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
      updateToLog.updatedDate = 'SYSUTCDATETIME()';

      updatesToLog.push(updateToLog);
      updatesToStore.push(updateToStore);
    },
  );

  return { updatesToLog, skipsToLog, updatesToStore };
};

module.exports = async (isDryRun, trx) => {
  console.log('========== Updating Lab Reorder Requests =========\n');

  const updatedOriginalLabOrderIds = await getUpdatedOriginalLabOrderIds();
  const updatedNewLabOrderIds = await getUpdatedNewLabOrderIds();
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

  if (!isDryRun) {
    // eslint-disable-next-line no-restricted-syntax
    for (const { labReorderRequestId, ...data } of updatesToStore) {
      // eslint-disable-next-line no-await-in-loop
      await knex('LabReorderRequest')
        .update(data)
        .where('LabReorderRequestId', labReorderRequestId)
        .transacting(trx);
    }
  }
};
