/* Zaria — Generate SQL for importing 29 historic members
 * Source: ZARIA_UHAI_SACCO_Tracker.xlsx (pasted by user, 2026-10-21)
 * Output: imports/import-29-historic-members.sql
 * Reads: hardcoded XLSX data below
 * Writes: one .sql file, nothing else
 * Does NOT touch the database.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// ─────────────────────────────────────────────────────────────────
// XLSX SOURCE DATA (transcribed from user's paste, 2026-10-21)
// memno -> { name, phone (raw), national_id (raw), reg_fee, shares_kes }
// ─────────────────────────────────────────────────────────────────
const MEMBERS = [
  { memno: 1,  name: 'Titus Kyalo',            phone: '728472981',  id: null,          reg_fee: 500, shares: 0    },
  { memno: 2,  name: 'Nicholas M Makau',       phone: '724948855',  id: '11676805',    reg_fee: 500, shares: 0    },
  { memno: 3,  name: 'Joseph M Ngei',          phone: '700902077',  id: '24239998',    reg_fee: 500, shares: 0    },
  { memno: 4,  name: 'Richard Ngao',           phone: null,         id: null,          reg_fee: 500, shares: 0    },
  { memno: 5,  name: 'Thomas Wambua',          phone: null,         id: '13638745',    reg_fee: 500, shares: 0    },
  { memno: 6,  name: 'Charles Musyoki',        phone: null,         id: null,          reg_fee: 500, shares: 0    },
  { memno: 7,  name: 'Rosemary Munyaka',       phone: '722378692',  id: null,          reg_fee: 500, shares: 0    },
  { memno: 8,  name: 'Immaculate Mutua',       phone: null,         id: null,          reg_fee: 500, shares: 0    },
  { memno: 9,  name: 'Domitilla Mutunga',      phone: null,         id: null,          reg_fee: 500, shares: 0    },
  { memno: 10, name: 'Boniface Mutinda',       phone: null,         id: null,          reg_fee: 500, shares: 2400 },
  { memno: 11, name: 'Thecla Eli',             phone: null,         id: null,          reg_fee: 300, shares: 0    },
  { memno: 12, name: 'John Kitavi',            phone: null,         id: null,          reg_fee: 300, shares: 0    },
  { memno: 13, name: 'Muasya Muange',          phone: '729170415',  id: null,          reg_fee: 500, shares: 2400 },
  { memno: 14, name: 'Veronicah Mutunga',      phone: null,         id: null,          reg_fee: 500, shares: 0    },
  { memno: 15, name: 'Celestine Muli',         phone: '725378825',  id: '26862862',    reg_fee: 500, shares: 0    },
  { memno: 16, name: 'John Michael',           phone: '113482966',  id: null,          reg_fee: 500, shares: 0    },
  { memno: 17, name: 'Derick Kyalo',           phone: null,         id: null,          reg_fee: 500, shares: 0    },
  { memno: 18, name: 'Magdalene Munyao',       phone: null,         id: '7867312',     reg_fee: 500, shares: 0    },
  { memno: 19, name: 'Michael Mwengi',         phone: '726042230',  id: '8833640',     reg_fee: 500, shares: 0    },
  { memno: 20, name: 'Jackson Muthusi',        phone: null,         id: '7788414',     reg_fee: 500, shares: 0    },
  { memno: 21, name: 'Damaris Mutiso',         phone: null,         id: '10175538',    reg_fee: 500, shares: 0    },
  { memno: 22, name: 'Kalimi Mutua',           phone: '795846504',  id: '30171048',    reg_fee: 500, shares: 0    },
  { memno: 23, name: 'Roman Wambua',           phone: null,         id: '734458271',   reg_fee: 500, shares: 0    },
  { memno: 24, name: 'Joseph Muema Musyimi',   phone: null,         id: '26945074',    reg_fee: 500, shares: 0    },
  { memno: 25, name: 'Daniel Munyithya',       phone: '799101921',  id: '33753979',    reg_fee: 500, shares: 2400 },
  { memno: 26, name: 'John Njeri',             phone: null,         id: '39269929',    reg_fee: 500, shares: 500  },
  { memno: 27, name: 'Beth Mwongeli Nzioka',   phone: '720735063',  id: '10174145',    reg_fee: 500, shares: 500  },
  { memno: 28, name: 'Victoria Mutiso',        phone: '715272927',  id: null,          reg_fee: 500, shares: 500  },
  { memno: 29, name: 'Marylene Mutio James',   phone: '713571861',  id: '14546965',    reg_fee: 500, shares: 1000 },
  { memno: 30, name: 'Purity Muange',          phone: '707081393',  id: '20799788',    reg_fee: 500, shares: 0    },
  { memno: 31, name: 'Winfred Mwanzia',        phone: '716498022',  id: '31902116',    reg_fee: 500, shares: 0    },
  { memno: 32, name: 'Ann Kiio Kyalo',         phone: '711531645',  id: '23264858',    reg_fee: 500, shares: 0    },
  { memno: 33, name: 'Beatrice Kanini',        phone: '791193883',  id: '28913328',    reg_fee: 500, shares: 0    },
  { memno: 34, name: 'Nicholas Wambua Musyoki',phone: '768509506',  id: null,          reg_fee: 500, shares: 0    },
  { memno: 35, name: 'Keneddy Mutuku',         phone: '705575388',  id: null,          reg_fee: 500, shares: 0    },
  { memno: 36, name: 'Kamene Makau',           phone: null,         id: null,          reg_fee: 500, shares: 0    },
];

// Monthly contributions — arrays [Jan..Dec] for 2025, then [Jan..Dec] for 2026
// 0 = no contribution that month, null = no entry / blank in XLSX
const MONTHLY_2025 = {
  1:  [0,0,0,600,500,1000,1000,500,500,500,500,500],
  2:  [0,0,0,2100,2500,2500,2500,2500,2500,2500,2500,2500],
  3:  [0,0,0,300,2500,2500,2500,2500,2500,2500,2500,2000],
  4:  [0,0,0,0,500,500,600,0,0,0,0,0],
  5:  [0,0,0,1600,0,0,0,0,0,0,0,0],
  6:  [0,0,0,0,0,0,0,0,0,0,0,0],
  7:  [0,0,0,0,0,0,0,0,0,0,0,0],
  8:  [0,0,0,0,0,0,0,0,0,0,0,0],
  9:  [0,0,0,0,0,300,0,0,0,0,0,0],
  10: [0,0,0,2100,2500,2500,600,4000,4000,4000,4000,4000],
  11: [0,0,0,0,0,0,0,0,0,0,0,0],
  12: [0,0,0,0,0,0,0,0,0,0,0,0],
  13: [0,0,0,0,600,350,350,350,350,350,350,500],
  14: [0,0,0,0,0,0,0,0,0,0,0,0],
  15: [0,0,0,0,0,300,300,0,0,0,0,0],
  16: [0,0,0,0,0,0,0,0,0,0,0,1000],
  17: [0,0,0,0,0,300,0,300,900,300,0,0],
  18: [0,0,0,0,0,600,0,0,0,0,0,0],
  19: [0,0,0,0,0,300,300,0,0,0,0,0],
  20: [0,0,0,0,0,0,300,0,0,0,0,0],
  21: [0,0,0,0,0,0,0,0,0,0,0,0],
  22: [0,0,0,0,0,0,500,300,0,0,0,0],
  23: [0,0,0,0,0,0,0,0,0,0,0,0],
  24: [0,0,0,0,0,0,0,800,0,0,0,0],
  25: [0,0,0,0,0,0,0,3600,5000,300,100,1500],
  26: [0,0,0,0,0,0,0,0,0,0,0,0],
  27: [0,0,0,0,0,0,0,0,0,0,0,0],
  28: [0,0,0,0,0,0,0,0,0,0,0,0],
  29: [0,0,0,0,0,0,0,0,0,0,0,0],
  30: [0,0,0,0,0,0,0,0,0,0,0,0],
  31: [0,0,0,0,0,0,0,0,0,0,0,0],
  32: [0,0,0,0,0,0,0,0,0,0,0,0],
  33: [0,0,0,0,0,0,0,0,0,0,0,0],
  34: [0,0,0,0,0,0,0,0,0,0,0,0],
  35: [0,0,0,0,0,0,0,0,0,0,0,0],
  36: [0,0,0,0,0,0,0,0,0,0,0,0],
};

const MONTHLY_2026 = {
  1:  [3000,0,1000,1000,0,0,1000,1000,0,1000,0,0],
  2:  [1000,0,0,0,0,5000,0,0,2500,0,0,0],
  3:  [2500,2500,2500,2000,0,5000,2300,2300,2300,2300,0,0],
  4:  [0,1000,0,300,500,300,300,0,300,300,0,0],
  5:  [0,0,0,300,500,300,300,500,300,300,0,0],
  6:  [0,0,0,0,0,0,0,0,0,0,0,0],
  7:  [0,0,0,0,0,0,0,0,0,0,0,0],
  8:  [0,0,0,0,0,0,0,0,0,0,0,0],
  9:  [0,0,0,0,0,0,0,0,0,0,0,0],
  10: [0,1900,0,3500,0,1000,0,0,0,0,0,0],
  11: [0,0,0,0,0,0,0,0,0,0,0,0],
  12: [0,0,0,0,0,0,0,0,0,0,0,0],
  13: [0,5000,0,0,500,500,500,1000,1000,1800,0,0],
  14: [0,0,0,0,0,0,0,0,0,0,0,0],
  15: [200,0,0,500,500,0,500,500,500,0,0,0],
  16: [500,0,0,0,500,0,0,0,0,0,0,0],
  17: [0,0,300,40,100,760,80,520,0,0,0,0],
  18: [0,0,0,0,0,0,0,0,0,0,0,0],
  19: [0,0,0,2000,0,600,1000,1500,1350,2000,0,0],
  20: [0,0,0,0,0,0,0,0,0,0,0,0],
  21: [0,0,0,0,0,0,0,0,0,0,0,0],
  22: [0,0,0,1000,0,0,600,0,300,0,0,0],
  23: [0,0,0,0,0,0,0,1430,1120,0,0,0],
  24: [0,0,0,0,0,0,0,0,0,0,0,0],
  25: [500,1400,300,400,0,500,0,500,500,0,0,0],
  26: [0,0,0,0,0,0,0,0,0,0,0,0],
  27: [500,0,0,3000,0,0,0,0,0,0,0,0],
  28: [500,0,0,0,0,0,0,0,0,0,0,0],
  29: [0,0,0,600,0,0,0,0,0,0,0,0],
  30: [0,0,0,1500,600,500,500,500,500,0,0,0],
  31: [0,0,0,0,0,0,0,400,0,0,0,0],
  32: [0,0,0,0,0,300,300,300,0,300,0,0],
  33: [0,0,0,0,0,0,300,300,300,300,300,0],
  34: [0,0,0,0,0,0,0,0,0,0,0,0],
  35: [0,0,0,0,0,0,300,360,1040,1000,900,0],
  36: [0,0,0,0,0,0,0,0,0,0,300,0],
};

// ─────────────────────────────────────────────────────────────────
// EXCLUDED — already in DB
// ─────────────────────────────────────────────────────────────────
const EXCLUDED_MEMNOS = [1, 2, 3, 4, 5, 22, 32];

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9)  return '254' + digits;
  if (digits.length === 10 && digits.startsWith('0')) return '254' + digits.slice(1);
  if (digits.length === 12 && digits.startsWith('254')) return digits;
  return digits; // fallback
}

function escapeSql(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

function sqlStr(v) {
  if (v == null) return 'NULL';
  return "'" + escapeSql(v) + "'";
}

function fmtMoney(n) {
  return Number(n).toFixed(2);
}

// ─────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────
let errors = [];
const toImport = MEMBERS.filter(m => !EXCLUDED_MEMNOS.includes(m.memno));

if (toImport.length !== 29) {
  errors.push('Expected 29 to import, got ' + toImport.length);
}

// Cross-check share sum
const sharesTotal = toImport.reduce((s, m) => s + (m.shares || 0), 0);
const EXPECTED_SHARES = 2400 + 2400 + 2400 + 500 + 500 + 500 + 1000;
if (sharesTotal !== EXPECTED_SHARES) {
  errors.push('Share total mismatch: expected ' + EXPECTED_SHARES + ', got ' + sharesTotal);
}

// Cross-check registration fee sum
const regFeeTotal = toImport.reduce((s, m) => s + m.reg_fee, 0);
const EXPECTED_FEES = 27 * 500 + 2 * 300;
if (regFeeTotal !== EXPECTED_FEES) {
  errors.push('Reg fee total mismatch: expected ' + EXPECTED_FEES + ', got ' + regFeeTotal);
}

// Cross-check monthly sums
let savingsTotal = 0;
toImport.forEach(m => {
  const s25 = (MONTHLY_2025[m.memno] || []).reduce((s, v) => s + v, 0);
  const s26 = (MONTHLY_2026[m.memno] || []).reduce((s, v) => s + v, 0);
  savingsTotal += s25 + s26;
});

if (errors.length) {
  console.error('❌ VALIDATION FAILED:');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}

console.log('✅ Validation passed');
console.log('   Members to import: ' + toImport.length);
console.log('   Reg fee total:     KES ' + regFeeTotal);
console.log('   Shares total:      KES ' + sharesTotal);
console.log('   Savings total:     KES ' + savingsTotal);

// ─────────────────────────────────────────────────────────────────
// SQL GENERATION
// ─────────────────────────────────────────────────────────────────
const lines = [];
function L(s) { lines.push(s); }

L('-- ZARIA UHAI SACCO — Import 29 Historic Members');
L('-- Generated: ' + new Date().toISOString());
L('-- Source: ZARIA_UHAI_SACCO_Tracker.xlsx (transcribed 2026-10-21)');
L('--');
L('-- SUMMARY');
L('--   Members imported:    29');
L('--   Reg fee total:       KES ' + regFeeTotal);
L('--   Shares total:        KES ' + sharesTotal + ' (7 members)');
L('--   Savings total:       KES ' + savingsTotal);
L('--');
L('-- All members get a placeholder user (member-<memno>@zaria.local).');
L('-- Password is random and thrown away. Login impossible.');
L('-- When real person signs up, admin merges via /admin/registrations.');
L('--');
L('-- ⚠️  RUN IN A SINGLE TRANSACTION. Type COMMIT or ROLLBACK yourself after');
L('--    inspecting the verification SELECTs at the bottom.');
L('');
L('START TRANSACTION;');
L('');

let clientCounter = 0;
let grandSavings = 0;
let grandShares = 0;
let grandFees = 0;

toImport.forEach(m => {
  clientCounter++;
  const phone = normalizePhone(m.phone) || ('PH-' + m.memno);
  const placeholderEmail = 'member-' + m.memno + '@zaria.local';
  const randomPwd = crypto.randomBytes(48).toString('hex');
  const bcryptHash = bcrypt.hashSync(randomPwd, 10);

  const months2025 = MONTHLY_2025[m.memno] || [];
  const months2026 = MONTHLY_2026[m.memno] || [];
  const total2025 = months2025.reduce((s, v) => s + v, 0);
  const total2026 = months2026.reduce((s, v) => s + v, 0);
  const totalSavings = total2025 + total2026;
  grandSavings += totalSavings;
  grandShares += m.shares || 0;
  grandFees += m.reg_fee;

  L('-- ──────────────────────────────────────────────────────');
  L('-- Member #' + m.memno + ': ' + m.name);
  L('--   phone: ' + (phone.startsWith('PH-') ? phone + ' (placeholder)' : phone));
  L('--   savings 2025=' + total2025 + '  2026=' + total2026 + '  total=' + totalSavings);
  L('--   shares=' + (m.shares || 0) + '   reg_fee=' + m.reg_fee);
  L('-- ──────────────────────────────────────────────────────');
  L('');

  // 1. Placeholder user
  L('INSERT INTO users (email, password_hash, role, must_change_password) VALUES (');
  L('  ' + sqlStr(placeholderEmail) + ',');
  L('  ' + sqlStr(bcryptHash) + ',');
  L("  'client',");
  L('  0');
  L(');');
  L('SET @uid_' + m.memno + ' = LAST_INSERT_ID();');
  L('');

  // 2. Client
  L('INSERT INTO clients (user_id, full_name, phone, national_id, status, created_by, registration_fee_paid, registration_fee_amount, registration_fee_paid_at, sms_opt_out, whatsapp_opt_in, ussd_enabled) VALUES (');
  L('  @uid_' + m.memno + ',');
  L('  ' + sqlStr(m.name) + ',');
  L('  ' + sqlStr(phone) + ',');
  L('  ' + sqlStr(m.id) + ',');
  L("  'active',");
  L('  1,');
  L('  1,');
  L('  ' + m.reg_fee + '.00,');
  L("  '2025-01-15 00:00:00',");
  L('  1, 0, 0');
  L(');');
  L('SET @cid_' + m.memno + ' = LAST_INSERT_ID();');
  L('');

  // 3. Savings account
  L('INSERT INTO savings_accounts (client_id, account_number, balance, total_deposited, total_withdrawn, total_interest_earned, interest_rate, status, opened_at) VALUES (');
  L('  @cid_' + m.memno + ',');
  L("  CONCAT('SAV-H', LPAD(" + m.memno + ", 4, '0')),");
  L('  ' + fmtMoney(totalSavings) + ',');
  L('  ' + fmtMoney(totalSavings) + ',');
  L('  0, 0, 0.0500,');
  L("  'active',");
  L("  '2025-01-01 00:00:00'");
  L(');');
  L('SET @sid_' + m.memno + ' = LAST_INSERT_ID();');
  L('');

  // 4. Savings transactions — only months with amount > 0
  let running = 0;
  const monthlyInserts = [];

  months2025.forEach((amt, idx) => {
    if (amt > 0) {
      running += amt;
      const mon = String(idx + 1).padStart(2, '0');
      monthlyInserts.push({ year: 2025, month: mon, amount: amt, running });
    }
  });
  months2026.forEach((amt, idx) => {
    if (amt > 0) {
      running += amt;
      const mon = String(idx + 1).padStart(2, '0');
      monthlyInserts.push({ year: 2026, month: mon, amount: amt, running });
    }
  });

  if (monthlyInserts.length > 0) {
    L('INSERT INTO savings_transactions (savings_account_id, type, amount, balance_after, channel, reference, notes, status, created_at) VALUES');
    const vals = monthlyInserts.map((row, i) => {
      const isLast = i === monthlyInserts.length - 1;
      return '  (@sid_' + m.memno + ", 'adjustment', " +
             row.amount + '.00, ' + row.running + '.00, ' +
             "'cash', 'XLSX-" + row.year + "-" + row.month + "', 'Historical import from XLSX', 'completed', '" +
             row.year + '-' + row.month + "-15 00:00:00')" + (isLast ? ';' : ',');
    }).join('\n');
    L(vals);
    L('');
  }

  // 5. Shares (only if any)
  if (m.shares && m.shares > 0) {
    const sharesHeld = Math.round(m.shares / 100);
    L('INSERT INTO share_holdings (client_id, shares_held, total_purchased, total_redeemed, total_invested, total_redeemed_value, first_purchase_at, last_transaction_at) VALUES (');
    L('  @cid_' + m.memno + ', ' + sharesHeld + ', ' + sharesHeld + ', 0, ' + fmtMoney(m.shares) + ', 0,');
    L("  '2025-01-15 00:00:00', '2025-01-15 00:00:00'");
    L(');');
    L('SET @hid_' + m.memno + ' = LAST_INSERT_ID();');
    L('');

    L('INSERT INTO share_transactions (holding_id, type, shares, price_per_share, total_amount, shares_after, payment_source, reference, notes, status, created_at) VALUES (');
    L('  @hid_' + m.memno + ", 'purchase', " + sharesHeld + ', 100.00, ' + fmtMoney(m.shares) + ', ' + sharesHeld + ",");
    L("  'cash', 'XLSX-2025-SHARES', 'Historical import from XLSX', 'completed', '2025-01-15 00:00:00'");
    L(');');
    L('');
  }

  // 6. Registration fee
  L('INSERT INTO registration_fees (client_id, amount, channel, status, notes, created_at) VALUES (');
  L('  @cid_' + m.memno + ", ' + m.reg_fee + ".00, 'cash', 'paid', 'Historical import from XLSX', '2025-01-15 00:00:00'");
  L(');');
  L('');
});

// ─────────────────────────────────────────────────────────────────
// VERIFICATION
// ─────────────────────────────────────────────────────────────────
L('');
L('-- ──────────────────────────────────────────────────────');
L('-- VERIFICATION — inspect all six (6) queries before typing COMMIT');
L('-- ──────────────────────────────────────────────────────');
L('');
L("SELECT '── V1: count ──' AS section;");
L("SELECT COUNT(*) AS clients_imported FROM clients WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'member-%@zaria.local');");
L('');
L("SELECT '── V2: reg fees ──' AS section;");
L("SELECT COUNT(*) AS count, SUM(amount) AS total FROM registration_fees WHERE client_id IN (SELECT id FROM clients WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'member-%@zaria.local'));");
L('');
L("SELECT '── V3: shares ──' AS section;");
L("SELECT COUNT(*) AS count, SUM(total_invested) AS total FROM share_holdings WHERE client_id IN (SELECT id FROM clients WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'member-%@zaria.local'));");
L('');
L("SELECT '── V4: savings ──' AS section;");
L("SELECT COUNT(*) AS count, SUM(balance) AS total FROM savings_accounts WHERE client_id IN (SELECT id FROM clients WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'member-%@zaria.local'));");
L('');
L("SELECT '── V5: per-client row count ──' AS section;");
L("SELECT c.id, c.full_name, c.phone, sa.balance, u.email FROM clients c");
L("  JOIN users u ON u.id = c.user_id");
L("  LEFT JOIN savings_accounts sa ON sa.client_id = c.id");
L(" WHERE u.email LIKE 'member-%@zaria.local'");
L(" ORDER BY c.id;");
L('');
L("SELECT '── V6: totals vs expected ──' AS section;");
L("SELECT 'clients' AS metric, COUNT(*) AS actual, 29 AS expected FROM clients WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'member-%@zaria.local')");
L("UNION ALL SELECT 'reg_fees_sum', CAST(SUM(amount) AS UNSIGNED), " + regFeeTotal + " FROM registration_fees WHERE client_id IN (SELECT id FROM clients WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'member-%@zaria.local'))");
L("UNION ALL SELECT 'shares_sum', CAST(SUM(total_invested) AS UNSIGNED), " + sharesTotal + " FROM share_holdings WHERE client_id IN (SELECT id FROM clients WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'member-%@zaria.local'))");
L("UNION ALL SELECT 'savings_sum', CAST(SUM(balance) AS UNSIGNED), " + savingsTotal + " FROM savings_accounts WHERE client_id IN (SELECT id FROM clients WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'member-%@zaria.local'));");
L('');
L('-- ──────────────────────────────────────────────────────');
L('-- ⚠️  DO NOT type COMMIT here automatically.');
L('--    Inspect V1-V6. If all match expected, type COMMIT;');
L('--    If anything is wrong, type ROLLBACK;');
L('-- ──────────────────────────────────────────────────────');
L('');
L('-- COMMIT;');
L('-- ROLLBACK;');

// ─────────────────────────────────────────────────────────────────
// WRITE
// ─────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, '..', 'imports', 'import-29-historic-members.sql');
fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

console.log('');
console.log('✅ SQL written to ' + outPath);
console.log('   Lines: ' + lines.length);
console.log('');
console.log('EXPECTED TOTALS (V6 should show these):');
console.log('   clients:     29');
console.log('   reg_fees:    ' + regFeeTotal);
console.log('   shares:      ' + sharesTotal);
console.log('   savings:     ' + savingsTotal);
