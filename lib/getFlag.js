'use strict';

const [, , ...flags] = process.argv;

module.exports = (flagToFind, isNumber) => {
  const passedFlag = flags.find(flag => flag.includes(`-${flagToFind}=`));
  if (!passedFlag) return undefined;
  const value = passedFlag.split('=')[1];
  return isNumber ? Number(value) : value;
};
