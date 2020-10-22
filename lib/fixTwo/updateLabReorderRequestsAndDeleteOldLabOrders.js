'use strict';

const knex = require('../knex');
const logLrrs = require('../logLrrs');
const getSubSortedTimelines = require('../getSubSortedTimelines');

const getUpdatedNewLabOrderIds = async trx => {
  const timelines = await getSubSortedTimelines(trx);

  const updatedNewLabOrderIds = {};

  const resetChanges = (timeline, labReorderRequestId) => {
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
  };

  Object.entries(timelines).forEach(([patientRegistrationId, timeline]) => {
    logLrrs(timeline);
    let skipPatient = false;
    timeline.forEach((evt, idx) => {
      // We want to look forward starting only from Lab Reorders that generated
      // Lab Orders with a NULL LabKitReference
      if (!evt.isReorder || evt.labKitReference || skipPatient) return;

      const futureEvents = timeline.slice(idx + 1);
      const { labReorderRequestId, newLabOrderId } = evt;

      // If the last thing that happened is a Reorder then we can't update the NewLabOrderId.
      // In this case the NewLabOrderId should be NULL, which should have been
      // filtered out in our initial query. As such, this is an unexpected condition
      // and we should skip this patient to avoid an unknown state.
      if (!futureEvents.length) {
        console.log(
          `ALERT: Lab Reorder Request ${labReorderRequestId} seems to be the last event for ` +
            `Patient Registration ${patientRegistrationId}, yet it has a NewLabOrderId ${evt.newLabOrderId}.`,
        );
        resetChanges(timeline, labReorderRequestId);
        return;
      }

      const nextEvent = futureEvents[0];

      // If the next event is a Reorder then the timeline has something strange
      // going on and we want to look more into this issue. As such we should skip this patient.
      if (nextEvent.isReorder) {
        console.log(
          `ALERT: Lab Reorder Request ${labReorderRequestId} seems to be immediately followed by ` +
            `Lab Reorder Request ${nextEvent.labReorderRequestId}, yet it has a NewLabOrderId ${newLabOrderId}.`,
        );
        resetChanges(timeline, labReorderRequestId);
        skipPatient = true;
        return;
      }

      // If the next event is a Lab Order with a LabOrderId that does not match the
      // current Reorder Request's NewLabOrderId, then the timeline has something
      // strange going on and we want to look more into this issue. As such we should skip this patient.
      if (nextEvent.labOrderId !== newLabOrderId) {
        console.log(
          `ALERT: Lab Reorder Request ${labReorderRequestId} seems to be immediately followed by ` +
            `Lab Order ${nextEvent.labOrderId}, which does not match the Request's NewLabOrderId ${newLabOrderId}.`,
        );
        resetChanges(timeline, labReorderRequestId);
        skipPatient = true;
        return;
      }

      // If the next Lab Order has a Lab Kit Reference, or there is only one
      // more Lab Order event next, then we are good to go and don't need to change the
      // Reorder Request's NewLabOrderId.
      if (nextEvent.labKitReference || futureEvents.length === 1) return;

      const nextNewestEvent = futureEvents[1];

      // If the next-newest event is a Reorder Request then we don't need to change the
      // Reorder Request's NewLabOrderId
      if (nextNewestEvent.isReorder) return;

      // If the next-newest Lab Order also does not have a LabKitReference then
      // then the timeline has something strange going on and we want to look more
      // into this issue. As such we should skip this patient.
      if (!nextNewestEvent.labKitReference) {
        console.log(
          `ALERT: Lab Reorder Request ${labReorderRequestId} is followed by 2 Lab Orders ` +
            `with NULL LabKitReferences: ${nextEvent.labOrderId} and ${nextNewestEvent.labOrderId}.`,
        );
        resetChanges(timeline, labReorderRequestId);
        skipPatient = true;
        return;
      }

      updatedNewLabOrderIds[labReorderRequestId] = {
        updatedNewLabOrderId: nextNewestEvent.labOrderId,
        oldNewLabOrderId: newLabOrderId,
      };
    });
  });

  return Object.entries(updatedNewLabOrderIds).map(
    ([labReorderRequestId, { updatedNewLabOrderId, oldNewLabOrderId }]) => ({
      labReorderRequestId,
      updatedNewLabOrderId,
      oldNewLabOrderId,
    }),
  );
};

module.exports = async (isDryRun, trx) => {
  console.log('========== Updating NewLabOrderId for Lab Reorder Requests =========\n');

  const updatedNewLabOrderIds = await getUpdatedNewLabOrderIds(trx);

  console.log(
    `${isDryRun ? 'We would update' : 'Updating'} ${
      updatedNewLabOrderIds.length
    } Lab Reorder Requests with the following changes:\n`,
  );
  updatedNewLabOrderIds.forEach(
    ({ labReorderRequestId, updatedNewLabOrderId, oldNewLabOrderId }) => {
      console.log({
        labReorderRequestId,
        newLabOrderId: { old: oldNewLabOrderId, new: updatedNewLabOrderId },
      });
    },
  );
  console.log();

  // eslint-disable-next-line no-restricted-syntax
  for (const { labReorderRequestId, updatedNewLabOrderId } of updatedNewLabOrderIds) {
    // eslint-disable-next-line no-await-in-loop
    await knex('LabReorderRequest')
      .update({ newLabOrderId: updatedNewLabOrderId })
      .where('LabReorderRequestId', labReorderRequestId)
      .transacting(trx);
  }

  console.log('========== Deleting Now-Orphaned Lab Orders =========\n');

  console.log(
    `${isDryRun ? 'We would delete' : 'Deleting'} the following ${
      updatedNewLabOrderIds.length
    } Lab Orders:\n`,
  );
  // Now, with the old Lab Orders "orphaned", delete them
  const idsToDelete = updatedNewLabOrderIds.map(({ oldNewLabOrderId }) => oldNewLabOrderId);
  console.log(idsToDelete.join(', '));
  console.log();

  await knex('LabOrder')
    .delete()
    .whereIn('LabOrderId', idsToDelete)
    .transacting(trx);
};
