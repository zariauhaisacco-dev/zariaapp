require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  // Ensure the tracking table exists (single-line string, no backticks)
  await conn.query(
    'CREATE TABLE IF NOT EXISTS _migrations (' +
    'filename VARCHAR(255) NOT NULL PRIMARY KEY, ' +
    'applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  );

  const [appliedRows] = await conn.query('SELECT filename FROM _migrations');
  const applied = new Set(appliedRows.map(r => r.filename));

  const dir = __dirname;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log('⏭  ' + file + ' (already applied)');
      continue;
    }
    console.log('Running ' + file + '...');
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    try {
      await conn.query(sql);
      await conn.query('INSERT INTO _migrations (filename) VALUES (?)', [file]);
      console.log('✅ ' + file + ' applied.');
      ran++;
    } catch (err) {
      console.error('❌ ' + file + ' failed: ' + err.message);
      await conn.end();
      process.exit(1);
    }
  }

  await conn.end();
  console.log('');
  console.log('Done. ' + ran + ' new migration(s) applied.');
})().catch(err => {
  console.error('❌ Migration runner error:', err.message);
  process.exit(1);
});
