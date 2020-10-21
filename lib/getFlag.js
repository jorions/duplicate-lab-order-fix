'use strict';

const [, , ...flags] = process.argv;

const flagHandlerMap = {
  lrr: lrrList => {
    const map = {};
    if (!lrrList) return map;
    lrrList.split(',').forEach(lrrId => {
      map[lrrId] = true;
    });
    return map;
  },
};

module.exports = flagToFind => {
  const passedFlag = flags.find(flag => flag.includes(`-${flagToFind}=`));
  const cb = flagHandlerMap[flagToFind];

  if (!passedFlag) return cb ? cb() : undefined;

  const value = passedFlag.split('=')[1];
  return cb ? cb(value) : value;
};
