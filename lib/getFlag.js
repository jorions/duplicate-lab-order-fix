'use strict';

const [, , ...flags] = process.argv;

module.exports = (flagToFind, cb) => {
  const passedFlag = flags.find(flag => flag.includes(`-${flagToFind}=`));
  if (!passedFlag) return cb ? cb() : undefined;
  const value = passedFlag.split('=')[1];
  return cb ? cb(value) : value;
};
