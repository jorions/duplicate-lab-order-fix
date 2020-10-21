'use strict';

const knex = require('./knex');

/*
Returns: {
  [patientRegistrationId]: [
    Lab Reorder Request: {
      newLabOrderId,
      labReorderRequestId,
      createdDate,
      labKitReference (of Lab Order that was created from Reorder),
      patientRegistrationId,
      isReorder: true,
    } ||
    Lab Order: {
      labOrderId,
      patientRegistrationId,
      labKitReference,
      createdDate,
    },
    ...
  ],
  ...
}
*/
module.exports = async trx => {
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
    .whereNotNull('lrr.newLabOrderId')
    .transacting(trx);

  // Get all Patient Registrations associated with those Lab Orders
  const allPatientRegistrations = await knex('LabOrder as lo')
    .select('pr.patientRegistrationId')
    .leftJoin('PatientRegistration as pr', 'pr.PatientRegistrationId', 'lo.PatientRegistrationId')
    .whereIn(
      'lo.LabOrderId',
      allLabReorders.map(({ newLabOrderId }) => newLabOrderId),
    )
    .transacting(trx);

  // Get all Lab Orders associated with those Patient Registrations
  const allLabOrders = await knex('LabOrder')
    .select('labOrderId', 'patientRegistrationId', 'labKitReference', 'createdDate')
    .whereIn(
      'PatientRegistrationId',
      allPatientRegistrations.map(({ patientRegistrationId }) => patientRegistrationId),
    )
    .transacting(trx);

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

  return timelines;
};
