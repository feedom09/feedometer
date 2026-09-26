/**
 * FeedOmeter 2.1 — SQL Server Connection Pool & Query Helper
 * Connects to Microsoft SQL Server Express 2022 (feedometer_db) via Native Windows Auth & SQL Auth
 */

const sql = require('mssql/msnodesqlv8');
require('dotenv').config();

const serverName = process.env.DB_SERVER || 'localhost';
const instanceName = process.env.DB_INSTANCE || 'SQLEXPRESS';
const database = process.env.DB_DATABASE || 'feedometer_db';

let connectionConfig;

if (process.env.DB_USER && process.env.DB_PASSWORD) {
  // SQL Authentication (Username & Password)
  connectionConfig = {
    server: `${serverName}\\${instanceName}`,
    database: database,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      trustServerCertificate: true,
      encrypt: process.env.DB_ENCRYPT === 'true' || false,
      enableArithAbort: true
    },
    pool: {
      max: 25,
      min: 2,
      idleTimeoutMillis: 30000
    }
  };
} else {
  // Windows Authentication (Trusted Connection / SSMS Mode)
  const connString = `Driver={ODBC Driver 18 for SQL Server};Server=${serverName}\\${instanceName};Database=${database};Trusted_Connection=yes;TrustServerCertificate=yes;`;
  connectionConfig = {
    connectionString: connString,
    pool: {
      max: 25,
      min: 2,
      idleTimeoutMillis: 30000
    }
  };
}

let pool = null;

async function getPool() {
  if (pool) return pool;
  try {
    pool = await sql.connect(connectionConfig);
    console.log(`[SQL Server] Connected successfully to ${serverName}\\${instanceName} [Database: ${database}] (Windows Auth)`);
    
    pool.on('error', err => {
      console.error('[SQL Server Pool Error]', err);
      pool = null;
    });
    
    return pool;
  } catch (err) {
    console.error('[SQL Server Connection Failed]', err.message);
    pool = null;
    throw err;
  }
}

/**
 * Execute a parameterized query with automatic pool management
 * @param {string} queryText - T-SQL query string
 * @param {Object} params - Key-value pair of parameters { paramName: { type, value } }
 */
async function query(queryText, params = {}) {
  const conn = await getPool();
  const request = conn.request();

  for (const [key, param] of Object.entries(params)) {
    if (param && param.type !== undefined) {
      request.input(key, param.type, param.value);
    } else {
      request.input(key, param);
    }
  }

  const result = await request.query(queryText);
  return result;
}

/**
 * Execute a stored procedure
 */
async function executeProc(procName, params = {}) {
  const conn = await getPool();
  const request = conn.request();

  for (const [key, param] of Object.entries(params)) {
    if (param && param.type !== undefined) {
      request.input(key, param.type, param.value);
    } else {
      request.input(key, param);
    }
  }

  const result = await request.execute(procName);
  return result;
}

module.exports = {
  sql,
  getPool,
  query,
  executeProc
};
