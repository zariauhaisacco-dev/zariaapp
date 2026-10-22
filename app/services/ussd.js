/*
 * Zaria — USSD handler
 *
 * Client dials *384*XXXX# on any phone (no smartphone, no data).
 * Ping Africa POSTs each step to our handler.
 * We respond with "CON ..." (continue) or "END ..." (close).
 *
 * Menu options:
 *   1 = Balance summary (savings + loans + chama)
 *   2 = Loan details
 *   3 = Chama details
 *   4 = Contact info
 */

const db = require('../db');

// ---------------------------------------------------------------
// Phone normalization
// ---------------------------------------------------------------
function normalizePhone(input) {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return '254' + digits.slice(1);
  if (digits.length === 9 && /^[17]/.test(digits)) return '254' + digits;
  return null;
}

// ---------------------------------------------------------------
// Format KES
// ---------------------------------------------------------------
function kes(n) {
  n = Number(n) || 0;
  return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ---------------------------------------------------------------
// Find client by phone
// ---------------------------------------------------------------
async function findClientByPhone(phone) {
  const [rows] = await db.query(
    'SELECT c.id, c.full_name, c.status, c.chama_id FROM clients c WHERE c.phone = ? LIMIT 1',
    [phone]
  );
  return rows.length ? rows[0] : null;
}

// ---------------------------------------------------------------
// Balance summary
// ---------------------------------------------------------------
async function getBalanceSummary(clientId) {
  const lines = [];

  // Savings
  const [savRows] = await db.query(
    "SELECT balance FROM savings_accounts WHERE client_id = ? AND status = 'active' LIMIT 1",
    [clientId]
  );
  const savingsBal = savRows.length ? Number(savRows[0].balance) : 0;
  lines.push('Savings: KES ' + kes(savingsBal));

  // Loan outstanding (or "no active loan")
  const [loanRows] = await db.query(
    "SELECT SUM(total_repayable - amount_repaid) AS outstanding FROM loans WHERE client_id = ? AND status IN ('active','overdue')",
    [clientId]
  );
  const loanOut = loanRows.length && loanRows[0].outstanding ? Number(loanRows[0].outstanding) : 0;
  if (loanOut > 0) {
    // Next due date
    const [dueRows] = await db.query(
      `SELECT lp.due_date, (lp.amount_due - lp.amount_paid) AS remaining
         FROM loan_payments lp
         JOIN loans l ON l.id = lp.loan_id
        WHERE l.client_id = ? AND lp.status IN ('pending','partial','overdue') AND l.status IN ('active','overdue')
        ORDER BY lp.due_date ASC LIMIT 1`,
      [clientId]
    );
    let dueText = '';
    if (dueRows.length) {
      const d = new Date(dueRows[0].due_date);
      const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      dueText = ' (next ' + day + ')';
    }
    lines.push('Loan: KES ' + kes(loanOut) + dueText);
  } else {
    lines.push('Loan: none');
  }

  // Chama
  const [clientRows] = await db.query('SELECT chama_id FROM clients WHERE id = ? LIMIT 1', [clientId]);
  const chamaId = clientRows.length ? clientRows[0].chama_id : null;
  if (chamaId) {
    const [contribRows] = await db.query(
      `SELECT amount_due, amount_paid, status FROM chama_contributions
        WHERE client_id = ? AND period = ? ORDER BY id DESC LIMIT 1`,
      [clientId, currentPeriod()]
    );
    if (contribRows.length) {
      const c = contribRows[0];
      lines.push('Chama: ' + kes(c.amount_paid) + '/' + kes(c.amount_due) + ' ' + c.status);
    } else {
      lines.push('Chama: active');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------
// Loan details
// ---------------------------------------------------------------
async function getLoanDetails(clientId) {
  const [loanRows] = await db.query(
    `SELECT id, principal, total_repayable, amount_repaid, term_months, status
       FROM loans WHERE client_id = ? AND status IN ('active','overdue')
       ORDER BY id DESC LIMIT 1`,
    [clientId]
  );

  if (!loanRows.length) {
    return 'You have no active loans.\nRequest one at zariauhai.com or call 0746 138 896.';
  }

  const loan = loanRows[0];
  const outstanding = Number(loan.total_repayable) - Number(loan.amount_repaid);

  const [dueRows] = await db.query(
    `SELECT due_date, (amount_due - amount_paid) AS remaining
       FROM loan_payments
      WHERE loan_id = ? AND status IN ('pending','partial','overdue')
      ORDER BY due_date ASC LIMIT 1`,
    [loan.id]
  );
  let dueText = '';
  if (dueRows.length) {
    const d = new Date(dueRows[0].due_date);
    const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    dueText = '\nNext due: ' + day + ' (KES ' + kes(dueRows[0].remaining) + ')';
  }

  return 'Your loan:\n' +
    'Principal: KES ' + kes(loan.principal) + '\n' +
    'Repaid: KES ' + kes(loan.amount_repaid) + '\n' +
    'Outstanding: KES ' + kes(outstanding) + dueText;
}

// ---------------------------------------------------------------
// Chama details
// ---------------------------------------------------------------
async function getChamaDetails(clientId) {
  const [clientRows] = await db.query('SELECT chama_id FROM clients WHERE id = ? LIMIT 1', [clientId]);
  const chamaId = clientRows.length ? clientRows[0].chama_id : null;
  if (!chamaId) {
    return 'You are not in a chama.\nAsk your chama admin for an invite link.';
  }

  const [chamaRows] = await db.query(
    'SELECT name, times_money_enabled FROM chamas WHERE id = ? LIMIT 1',
    [chamaId]
  );
  if (!chamaRows.length) return 'Chama not found.';
  const chama = chamaRows[0];

  const [contribRows] = await db.query(
    `SELECT amount_due, amount_paid, status FROM chama_contributions
      WHERE client_id = ? AND period = ? LIMIT 1`,
    [clientId, currentPeriod()]
  );

  let text = chama.name + ':\n';
  if (contribRows.length) {
    const c = contribRows[0];
    text += 'Your contribution: ' + kes(c.amount_paid) + '/' + kes(c.amount_due) + ' ' + c.status + '\n';
  } else {
    text += 'No contribution this period\n';
  }

  const [acctRows] = await db.query(
    'SELECT balance FROM chama_savings_accounts WHERE chama_id = ? LIMIT 1',
    [chamaId]
  );
  if (acctRows.length) {
    text += 'Group balance: KES ' + kes(acctRows[0].balance);
  }

  return text;
}

// ---------------------------------------------------------------
// Contact
// ---------------------------------------------------------------
function getContactText() {
  return 'Call us: 0746 138 896\n' +
    'Email: info@zariauhai.com\n' +
    'Hours: Mon-Sat 8am-6pm\n' +
    'Web: zariauhai.com';
}

// ---------------------------------------------------------------
// Current period (matches chama.currentPeriod)
// ---------------------------------------------------------------
function currentPeriod() {
  const now = new Date();
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = eat.getUTCFullYear();
  const m = eat.getUTCMonth() + 1;
  return y + '-' + (m < 10 ? '0' + m : String(m));
}

// ---------------------------------------------------------------
// Main session handler
// ---------------------------------------------------------------
async function handleSession({ sessionId, phoneNumber, text, serviceCode }) {
  const phone = normalizePhone(phoneNumber);
  if (!phone) {
    return { response: 'END Invalid phone number. Please try again.' };
  }

  // Look up client
  const client = await findClientByPhone(phone);
  if (!client) {
    return {
      response: 'END Your number is not registered with Zaria Uhai SACCO.\nJoin at zariauhai.com or call 0746 138 896.',
    };
  }

  if (client.status !== 'active') {
    return {
      response: 'END Your account is ' + client.status + '.\nContact us on 0746 138 896.',
    };
  }

  const input = (text || '').trim();

  // Initial call — show menu
  if (!input) {
    await logSession({ sessionId, phone, serviceCode, clientId: client.id, state: 'menu', lastInput: '', lastResponse: 'shown' });
    return {
      response: 'CON Welcome to Zaria Uhai SACCO\n' +
        '1. Check balance\n' +
        '2. Loan status\n' +
        '3. Chama status\n' +
        '4. Talk to us',
    };
  }

  // Route based on input
  try {
    if (input === '1') {
      const summary = await getBalanceSummary(client.id);
      await logSession({ sessionId, phone, serviceCode, clientId: client.id, state: 'done', lastInput: '1', lastResponse: summary.substring(0, 100) });
      return { response: 'END ' + summary };
    }
    if (input === '2') {
      const details = await getLoanDetails(client.id);
      await logSession({ sessionId, phone, serviceCode, clientId: client.id, state: 'done', lastInput: '2', lastResponse: details.substring(0, 100) });
      return { response: 'END ' + details };
    }
    if (input === '3') {
      const chamaInfo = await getChamaDetails(client.id);
      await logSession({ sessionId, phone, serviceCode, clientId: client.id, state: 'done', lastInput: '3', lastResponse: chamaInfo.substring(0, 100) });
      return { response: 'END ' + chamaInfo };
    }
    if (input === '4') {
      await logSession({ sessionId, phone, serviceCode, clientId: client.id, state: 'done', lastInput: '4', lastResponse: 'contact' });
      return { response: 'END ' + getContactText() };
    }

    // Invalid option
    await logSession({ sessionId, phone, serviceCode, clientId: client.id, state: 'done', lastInput: input, lastResponse: 'invalid' });
    return { response: 'END Invalid option. Dial *384*XXXX# again.' };
  } catch (err) {
    console.error('[ussd handle]', err.message);
    return { response: 'END Service temporarily unavailable. Please try again.' };
  }
}

// ---------------------------------------------------------------
// Session logging
// ---------------------------------------------------------------
async function logSession({ sessionId, phone, serviceCode, clientId, state, lastInput, lastResponse }) {
  try {
    await db.query(
      `INSERT INTO ussd_sessions (session_id, phone, service_code, client_id, state, last_input, last_response, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         state = VALUES(state),
         last_input = VALUES(last_input),
         last_response = VALUES(last_response),
         updated_at = NOW(),
         ended_at = IF(VALUES(state) = 'done', NOW(), ended_at)`,
      [sessionId, phone, serviceCode || '', clientId || null, state || 'menu', lastInput || '', lastResponse || '']
    );
  } catch (err) {
    console.error('[ussd logSession]', err.message);
  }
}

module.exports = {
  handleSession,
  normalizePhone,
};
