require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./app/db');

(async () => {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error('Usage: node scripts-create-admin.js <email> <password>');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) {
    console.error('User already exists with that email.');
    process.exit(1);
  }

  const [result] = await db.query(
    'INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?)',
    [email.toLowerCase(), hash, 'admin', 0]
  );

  console.log(`✅ Admin created. ID: ${result.insertId}, email: ${email}`);
  process.exit(0);
})().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
