'use strict';

const knex = require('knex');

const knexConfig = {
  client: 'mssql',
  connection: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    requestTimeout: 120000, // Allow two minute for queries
    options: { multiSubnetFailover: true, encrypt: true, enableArithAbort: true },
  },
};

const knexConnection = knex(knexConfig);

module.exports = knexConnection;
