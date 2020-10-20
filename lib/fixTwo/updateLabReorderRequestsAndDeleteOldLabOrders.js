'use strict';

const knex = require('../knex');
const getSubSortedTimelines = require('../getSubSortedTimelines');

// On timeline, if Lab Order after Reorder Request has NULL LabKitReference,
// and then the next event on the timeline is another Lab Order with a LabKitReference,
// update the LabReorderRequest.NewLabOrderId to the LabOrderId of the Lab Order
// we with a LabKitReference.
// Now, with the old Lab Reorder Request "orphaned", delete it.
module.exports = async (isDryRun, trx) => {};
