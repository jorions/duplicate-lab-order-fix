'use strict';

const knex = require('../knex');
const getLabOrderMap = require('./getLabOrderMap');

const getLabOrdersToSetBackToNull = async trx => {
  const labOrderMap = await getLabOrderMap(trx);

  // If the oldest instance of Lab Order has a Lab Reorder Request associated to it,
  // and that Reorder Request was created BEFORE the next-newest instance of the Lab
  // Order, that means it was a Lab Order that got rejected by CoreMedica, and thus kept its
  // NULL LabKitReference, that then got incorrectly updated to the LabKitReference of
  // a new, legitimate Lab Order thanks to the combination of bugs
  // https://catapulthealth.atlassian.net/browse/DEV-8205 and https://catapulthealth.atlassian.net/browse/DEV-8048
  const labOrdersToSetBackToNull = [];

  const recurseOverLabOrders = async (labKitReference, labOrdersTimeline) => {
    const oldestLabOrder = labOrdersTimeline[labOrdersTimeline.length - 1];
    const nextNewestLabOrder = labOrdersTimeline[labOrdersTimeline.length - 2];
    const relatedLabReorderRequest = await knex('LabReorderRequest')
      .first('createdDate')
      .where('OriginalLabOrderId', oldestLabOrder.labOrderId);

    // When Lab Reorder Request is older than the next-newest instance of the Lab Order, reset
    if (
      relatedLabReorderRequest &&
      relatedLabReorderRequest.createdDate < nextNewestLabOrder.createdDate
    )
      labOrdersToSetBackToNull.push({
        oldLabKitReference: labKitReference,
        labOrderId: oldestLabOrder.labOrderId,
      });

    if (labOrdersTimeline.length > 2)
      await recurseOverLabOrders(labKitReference, labOrdersTimeline.slice(0, -1));
  };

  // eslint-disable-next-line no-restricted-syntax
  for (const [labKitReference, labOrdersTimeline] of Object.entries(labOrderMap)) {
    // eslint-disable-next-line no-await-in-loop
    await recurseOverLabOrders(labKitReference, labOrdersTimeline);
  }

  return labOrdersToSetBackToNull;
};

module.exports = async (isDryRun, trx) => {
  console.log(
    '========== Setting Accidentally Overwritten Lab Order Fields Back to NULL =========\n',
  );

  const labOrdersToSetBackToNull = await getLabOrdersToSetBackToNull(trx);

  console.log(
    `${isDryRun ? 'We would reset' : 'Resetting'} fields to NULL for the following ${
      labOrdersToSetBackToNull.length
    } Lab Orders:\n`,
  );
  labOrdersToSetBackToNull.forEach(({ oldLabKitReference, labOrderId }) => {
    console.log({ labOrderId, oldLabKitReference });
  });
  console.log();

  await knex('LabOrder')
    .update({
      shipmentTrackingToPatient: null,
      shipmentTrackingToLab: null,
      labKitReference: null,
      labSentDate: null,
      labSampleCollectedDate: null,
      labReturnedDate: null,
      labCompletedDate: null,
      labErrorDate: null,
      homeKitDeliveredDate: null,
      homeKitReturnedDate: null,
      updatedDate: knex.ref('CreatedDate'),
    })
    .whereIn(
      'LabOrderId',
      labOrdersToSetBackToNull.map(({ labOrderId }) => labOrderId),
    )
    .transacting(trx);
};
