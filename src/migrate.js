require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await db.pool.query(sql);
  console.log('Banco BrainMed migrado com sucesso.');
  await db.pool.end();
}

migrate().catch(async error => {
  console.error(error);
  await db.pool.end();
  process.exit(1);
});
