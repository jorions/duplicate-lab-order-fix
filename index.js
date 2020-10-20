'use strict';

require('dotenv').config();

const fix = require('./lib/fix');
const fixTwo = require('./lib/fixTwo');

process.on('uncaughtException', err => {
  console.error({ err }, 'Uncaught Exception Trapped');
});

if (process.env.TO_RUN === 'fix') fix();
else if (process.env.TO_RUN === 'fixTwo') fixTwo();
