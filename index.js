'use strict';

require('dotenv').config();

const fix = require('./lib/fix');

process.on('uncaughtException', err => {
  console.error({ err }, 'Uncaught Exception Trapped');
});

fix();
