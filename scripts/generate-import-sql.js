#!/usr/bin/env node
/* Zaria — Historic Members Import SQL Generator
 * Reads hard-coded XLSX data, validates, emits SQL to imports/
 * Never touches the DB. Safe to run repeatedly.
 *
 * Usage: node scripts/generate-import-sql.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

// XLSX data — 28 members (Muasya excluded pending amount verification)
// Format: [memno, name, phone_raw, national_id, reg_fee, shares_kes,
//          m2025[12], m2026[12], xlsx25_total, xlsx26_total]
const MEMBERS = [
  [6,  'Charles Musyoki',        'blank',     null,         500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 0, 0],
  [7,  'Rosemary Munyaka',       '722378692', null,         500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 0, 0],
  [8,  'Immaculate Mutua',       'blank',     null,         500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 0, 0],
  [9,  'Domitilla Mutunga',      'blank',     null,         500, 0,
    [0,0,0,0,0,300,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 300, 0],
  [10, 'Boniface Mutinda',       '726490147', null,         500, 2400,
    [0,0,0,2100,2500,2500,600,4000,4000,4000,4000,4000],
    [0,1900,0,3500,0,1000,0,0,0,0,0,0], 27700, 6400],
  [11, 'Thecla Eli',             'blank',     null,         300, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 0, 0],
  [12, 'John Kitavi',            'blank',     null,         300, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 0, 0],
  [14, 'Veronicah Mutunga',      'blank',     null,         500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 0, 0],
  [15, 'Celestine Muli',         '725378825', '26862862',   500, 0,
    [0,0,0,0,0,300,300,0,0,0,0,0],
    [200,0,0,500,500,0,500,300,500,500,0,0], 600, 3000],
  [16, 'John Michael',           '113482966', null,         500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,1000],
    [500,0,0,0,500,500,0,0,0,0,0,0], 1000, 1500],
  [17, 'Derick Kyalo',           'blank',     null,         500, 0,
    [0,0,0,0,0,300,0,300,900,300,0,0],
    [0,0,300,40,100,760,80,520,0,0,0,0], 1800, 1800],
  [18, 'Magdalene Munyao',       'blank',     '7867312',    500, 0,
    [0,0,0,0,0,600,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 600, 0],
  [19, 'Michael Mwengi',         '726042230', '8833640',    500, 0,
    [0,0,0,0,0,300,300,0,0,0,0,0],
    [0,0,0,2000,0,600,1000,1000,1350,2000,0,0], 600, 7950],
  [20, 'Jackson Muthusi',        'blank',     '7788414',    500, 0,
    [0,0,0,0,0,0,300,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 300, 0],
  [21, 'Damaris Mutiso',         'blank',     '10175538',   500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 0, 0],
  [23, 'Roman Wambua',           'blank',     '734458271',  500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1430,1120,0,0,0], 0, 2550],
  [24, 'Joseph Muema Musyimi',   'blank',     '26945074',   500, 0,
    [0,0,0,0,0,0,0,800,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 800, 0],
  [25, 'Daniel Munyithya',       '799101921', '33753979',   500, 2400,
    [0,0,0,0,0,0,0,3600,5000,300,100,1500],
    [500,1400,300,400,0,500,0,500,500,0,0,0], 10500, 4100],
  [26, 'John Njeri',             'blank',     '39269929',   500, 500,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 0, 0],
  [27, 'Beth Mwongeli Nzioka',   '720735063', '10174145',   500, 500,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [500,0,0,3000,0,0,0,0,0,0,0,0], 0, 3500],
  [28, 'Victoria Mutiso',        '715272927', null,         500, 500,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [500,0,0,0,0,0,0,0,0,0,0,500], 0, 1000],
  [29, 'Marylene Mutio James',   '713571861', '14546965',   500, 1000,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,600,0,0,0,0,0,0,0,0], 0, 600],
  [30, 'Purity Muange',          '707081393', '20799788',   500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,1500,600,500,500,500,500,0,0,0], 0, 4100],
  [31, 'Winfred Mwanzia',        '716498022', '31902116',   500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,400,0,0,0,0,0], 0, 400],
  [33, 'Beatrice Kanini',        '791193883', '28913328',   500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 0, 0],
  [34, 'Nicholas Wambua Musyoki','768509506', null,         500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,300,300,0,300,300,0,0], 0, 1200],
  [35, 'Keneddy Mutuku',         '705575388', null,         500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,300,360,1040,1000,900,0,0], 0, 3600],
  [36, 'Kamene Makau',           'blank',     null,         500, 0,
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0], 0, 0]
];

const EXCLUDE_IDS = new Set([
  '55667788','38251055','24239998','11676805','37846706',
  '23264858','30171048','22667856','33310020','13638745'
]);
const EXCLUDE_NAMES = new Set([
  'mary wanjiku','dickson njuguna','jp zaria','nicholas makau',
  'miriam nzioka','ann nduku kiio','kalimi mutua','titus kyalo nthenge',
  'richard ngao musingi','thomas wambua kimeu'
]);

function normalizePhone(raw) {
  if (!raw || raw === 'blank') return null;
  let p = String(raw).trim();
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.length === 9) p = '254' + p;
  return p;
}

function placeholderEmail(memno) { return 'member-' + memno + '@zaria.local'; }
function placeholderPhone(memno) { return 'PH-' + memno; }
function monthLabel(idx) { return String(idx + 1).padStart(2, '0'); }
function sqlEscape(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
}

function validate() {
  const errors = [];
  if (MEMBERS.length !== 28) {
    errors.push(`Expected 28 members, got ${MEMBERS.length}`);
  }
  const seenIds = new Set();
  const seenNames = new Set();
  MEMBERS.forEach(function (m) {
    const [memno, name, phone, natId, regFee, shares, m2025, m2026, xlsx25, xlsx26] = m;
    if (natId && EXCLUDE_IDS.has(String(natId))) {
      errors.push(`Member ${memno} (${name}): national_id ${natId} already in DB`);
    }
    if (natId && seenIds.has(String(natId))) {
      errors.push(`Member ${memno} (${name}): duplicate national_id ${natId}`);
    }
    if (natId) seenIds.add(String(natId));
    const nameKey = name.toLowerCase();
    if (EXCLUDE_NAMES.has(nameKey)) {
      errors.push(`Member ${memno} (${name}): name already in DB`);
    }
    if (seenNames.has(nameKey)) {
      errors.push(`Member ${memno} (${name}): duplicate name`);
    }
    seenNames.add(nameKey);
    const sum25 = m2025.reduce((a, b) => a + b, 0);
    const sum26 = m2026.reduce((a, b) => a + b, 0);
    if (sum25 !== xlsx25) {
      errors.push(`Member ${memno} (${name}): 2025 sum ${sum25} != XLSX ${xlsx25}`);
    }
    if (sum26 !== xlsx26) {
      errors.push(`Member ${memno} (${name}): 2026 sum ${sum26} != XLSX ${xlsx26}`);
    }
    if (regFee !== 500 && regFee !== 300) {
      errors.push(`Member ${memno} (${name}): unexpected reg_fee ${regFee}`);
    }
    if (shares !== 0 && shares % 100 !== 0) {
      errors.push(`Member ${memno} (${name}): share value ${shares} not /100`);
    }
  });
  return errors;
}

function generateSql() {
  const lines = [];
  lines.push('-- ═══════════════════════════════════════════════════════════════');
  lines.push('-- ZARIA — IMPORT 28 HISTORIC MEMBERS (Muasya pending)');
  lines.push('-- Generated: ' + new Date().toISOString());
  lines.push('-- Baseline: 10 clients, 11 users, 10 savings_accounts');
  lines.push('-- Expected after COMMIT: 38 clients, 39 users, 38 savings_accounts');
  lines.push('-- ═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('START TRANSACTION;');
  lines.push('');

  let expectedTotalSavings = 0;
  let expectedTotalShares = 0;
  let expectedTotalRegFees = 0;

  MEMBERS.forEach(function (m) {
    const [memno, name, phoneRaw, natId, regFee, shares, m2025, m2026] = m;
    const phone = normalizePhone(phoneRaw) || placeholderPhone(memno);
    const email = placeholderEmail(memno);
    const totalSavings = m2025.reduce((a, b) => a + b, 0) + m2026.reduce((a, b) => a + b, 0);

    expectedTotalSavings += totalSavings;
    expectedTotalShares += shares;
    expectedTotalRegFees += regFee;

    lines.push('-- ─── Member ' + memno + ': ' + name + ' ───');
    lines.push('');
    lines.push('INSERT INTO users (email, password_hash, role, must_change_password)');
    lines.push("VALUES (" + sqlEscape(email) + ", '$2a$12$NOTAREALHASHXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 'client', 0);");
    lines.push('SET @uid_' + memno + ' = LAST_INSERT_ID();');
    lines.push('');
    lines.push('INSERT INTO clients (user_id, full_name, phone, national_id, status, created_by, registration_fee_paid, registration_fee_amount, registration_fee_paid_at, sms_opt_out, whatsapp_opt_in, ussd_enabled)');
    lines.push('VALUES (@uid_' + memno + ', ' + sqlEscape(name) + ', ' + sqlEscape(phone) + ', ' + (natId ? sqlEscape(String(natId)) : 'NULL') + ", 'active', 1, 1, " + regFee + ", '2025-01-15', 1, 0, 0);");
    lines.push('SET @cid_' + memno + ' = LAST_INSERT_ID();');
    lines.push('');
    lines.push('INSERT INTO savings_accounts (client_id, account_number, balance, total_deposited, total_withdrawn, total_interest_earned, interest_rate, status, opened_at)');
    lines.push("VALUES (@cid_" + memno + ", CONCAT('SAV-', LPAD(FLOOR(RAND() * 900000) + 100000, 6, '0')), " + totalSavings + ', ' + totalSavings + ", 0, 0, 0.0500, 'active', '2025-01-01');");
    lines.push('SET @sid_' + memno + ' = LAST_INSERT_ID();');

    if (totalSavings > 0) {
      lines.push('');
      let running = 0;
      const rows = [];
      m2025.forEach(function (amt, i) {
        if (amt > 0) {
          running += amt;
          rows.push("(@sid_" + memno + ", 'adjustment', " + amt + ", " + running + ", 'cash', NULL, 'XLSX-2025-" + monthLabel(i) + "', 'Historical import from XLSX', 'completed', '2025-" + monthLabel(i) + "-15 00:00:00')");
        }
      });
      m2026.forEach(function (amt, i) {
        if (amt > 0) {
          running += amt;
          rows.push("(@sid_" + memno + ", 'adjustment', " + amt + ", " + running + ", 'cash', NULL, 'XLSX-2026-" + monthLabel(i) + "', 'Historical import from XLSX', 'completed', '2026-" + monthLabel(i) + "-15 00:00:00')");
        }
      });
      lines.push('INSERT INTO savings_transactions (savings_account_id, type, amount, balance_after, channel, mpesa_receipt, reference, notes, status, created_at)');
      lines.push('VALUES');
      lines.push('  ' + rows.join(',\n  ') + ';');
    }

    if (shares > 0) {
      const shareCount = shares / 100;
      lines.push('');
      lines.push('INSERT INTO share_holdings (client_id, shares_held, total_purchased, total_redeemed, total_invested, total_redeemed_value, first_purchase_at, last_transaction_at)');
      lines.push("VALUES (@cid_" + memno + ", " + shareCount + ", " + shareCount + ", 0, " + shares + ", 0, '2025-01-15', '2025-01-15');");
      lines.push('SET @hid_' + memno + ' = LAST_INSERT_ID();');
      lines.push('INSERT INTO share_transactions (holding_id, type, shares, price_per_share, total_amount, shares_after, payment_source, reference, notes, status, created_at)');
      lines.push("VALUES (@hid_" + memno + ", 'purchase', " + shareCount + ", 100, " + shares + ", " + shareCount + ", 'cash', 'XLSX-2025-SHARES', 'Historical import from XLSX', 'completed', '2025-01-15 00:00:00');");
    }

    lines.push('');
    lines.push('INSERT INTO registration_fees (client_id, amount, channel, status, notes, created_at)');
    lines.push("VALUES (@cid_" + memno + ", " + regFee + ", 'cash', 'paid', 'Historical import from XLSX', '2025-01-15 00:00:00');");
    lines.push('');
  });

  lines.push('-- ═══════════════════════════════════════════════════════════════');
  lines.push('-- VERIFICATION — inspect BEFORE typing COMMIT');
  lines.push('-- ═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push("SELECT '── V1: total clients (expect 38) ──' AS section;");
  lines.push('SELECT COUNT(*) AS total_clients FROM clients;');
  lines.push('');
  lines.push("SELECT '── V2: placeholder users (expect 28) ──' AS section;");
  lines.push("SELECT COUNT(*) AS placeholder_users FROM users WHERE email LIKE 'member-%@zaria.local';");
  lines.push('');
  lines.push("SELECT '── V3: new savings accounts (expect 28) ──' AS section;");
  lines.push("SELECT COUNT(*) AS new_accounts FROM savings_accounts sa JOIN clients c ON c.id = sa.client_id JOIN users u ON u.id = c.user_id WHERE u.email LIKE 'member-%@zaria.local';");
  lines.push('');
  lines.push("SELECT '── V4: total savings (expect " + expectedTotalSavings + ") ──' AS section;");
  lines.push("SELECT COALESCE(SUM(st.amount), 0) AS total FROM savings_transactions st JOIN savings_accounts sa ON sa.id = st.savings_account_id JOIN clients c ON c.id = sa.client_id JOIN users u ON u.id = c.user_id WHERE u.email LIKE 'member-%@zaria.local' AND st.reference LIKE 'XLSX-%';");
  lines.push('');
  lines.push("SELECT '── V5: total shares (expect " + expectedTotalShares + ") ──' AS section;");
  lines.push("SELECT COALESCE(SUM(sh.total_invested), 0) AS total FROM share_holdings sh JOIN clients c ON c.id = sh.client_id JOIN users u ON u.id = c.user_id WHERE u.email LIKE 'member-%@zaria.local';");
  lines.push('');
  lines.push("SELECT '── V6: total reg fees (expect " + expectedTotalRegFees + ") ──' AS section;");
  lines.push("SELECT COALESCE(SUM(rf.amount), 0) AS total FROM registration_fees rf JOIN clients c ON c.id = rf.client_id JOIN users u ON u.id = c.user_id WHERE u.email LIKE 'member-%@zaria.local';");
  lines.push('');
  lines.push("SELECT '── V7: existing 10 clients untouched ──' AS section;");
  lines.push('SELECT id, full_name, phone FROM clients WHERE id IN (1,3,6,12,14,15,16,17,18,23) ORDER BY id;');
  lines.push('');
  lines.push('-- ⚠️  DO NOT type COMMIT yet — inspect V1–V7 first');
  lines.push('-- COMMIT;');
  lines.push('-- ROLLBACK;');
  lines.push('');

  const outPath = path.join(__dirname, '..', 'imports', 'import-28-historic-members.sql');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

  return { outPath, expectedTotalSavings, expectedTotalShares, expectedTotalRegFees };
}

console.log('=== Zaria historic member import — SQL generator ===');
console.log('');
const errors = validate();
if (errors.length > 0) {
  console.error('❌ VALIDATION FAILED:');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log('✅ Validation passed: 28 members, all totals match XLSX, no collisions');
const result = generateSql();
console.log('');
console.log('✅ SQL generated:');
console.log('   File: ' + result.outPath);
console.log('   Expected savings: KES ' + result.expectedTotalSavings);
console.log('   Expected shares:  KES ' + result.expectedTotalShares);
console.log('   Expected reg fees: KES ' + result.expectedTotalRegFees);
console.log('');
