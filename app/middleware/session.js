const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

function buildSessionMiddleware() {
  const store = new MySQLStore({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    createDatabaseTable: false,
    schema: {
      tableName: 'sessions',
      columnNames: {
        session_id: 'session_id',
        expires: 'expires',
        data: 'data',
      },
    },
  });

  // Secure cookies ON in production UNLESS explicitly overridden for local testing
  const isProd = process.env.NODE_ENV === 'production';
  const forceInsecure = process.env.FORCE_INSECURE_COOKIE === '1';

  return session({
    name: 'zaria.sid',
    secret: process.env.SESSION_SECRET,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProd && !forceInsecure,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8,
      domain: process.env.COOKIE_DOMAIN || undefined,
    },
  });
}

module.exports = { buildSessionMiddleware };
