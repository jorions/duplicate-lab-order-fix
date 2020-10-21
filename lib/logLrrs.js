'use strict';

const getFlag = require('./getFlag');

const lrrsToLog = getFlag('lrr');

module.exports = timeline => {
  const evtsToLog = timeline.filter(({ labReorderRequestId }) => lrrsToLog[labReorderRequestId]);
  if (evtsToLog.length) {
    console.log('=====');
    console.log(
      `Logging Timeline for Lab Reorder Request${evtsToLog.length === 1 ? '' : 's'} ${evtsToLog
        .map(({ labReorderRequestId }) => labReorderRequestId)
        .join(', ')}:`,
    );
    console.log(timeline);
    console.log('=====');
    console.log();
  }
};
