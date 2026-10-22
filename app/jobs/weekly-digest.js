/*
 * Zaria — Weekly digest email
 *
 * Runs every Sunday at 6:00 UTC (9:00 EAT).
 * Sends a summary email to every active client.
 * Email-only (no SMS) to avoid credit burn.
 *
 * Usage:
 *   node app/jobs/weekly-digest.js             -- real send
 *   node app/jobs/weekly-digest.js --dry-run   -- preview only
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('../db');
const email = require('../services/email');

const DRY_RUN = process.argv.includes('--dry-run');

function fmtMoney(n) {
  n = Number(n) || 0;
  return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function firstName(full) {
  return String(full || '').trim().split(/\s+/)[0] || 'Member';
}

// -----------------------------------------------------------------
// Build one client's digest data
// -----------------------------------------------------------------
async function buildDigest(clientId) {
  const [clientRows] = await db.query(
    `SELECT c.id, c.full_name, c.phone, c.chama_id, u.email
       FROM clients c JOIN users u ON u.id = c.user_id
      WHERE c.id = ? LIMIT 1`,
    [clientId]
  );
  if (!clientRows.length) return null;
  const client = clientRows[0];

  // Savings
  const [saRows] = await db.query(
    `SELECT account_number, balance, total_deposited FROM savings_accounts WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  const savings = saRows[0] || null;

  // Weekly contribution (last 7 days)
  let weeklyContribution = 0;
  let lastContributionDate = null;
  if (savings) {
    const [wRows] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM savings_transactions
        WHERE savings_account_id = (SELECT id FROM savings_accounts WHERE client_id = ? LIMIT 1)
          AND status = 'completed'
          AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [clientId]
    );
    weeklyContribution = Number(wRows[0].total) || 0;

    const [lastRows] = await db.query(
      `SELECT created_at FROM savings_transactions
        WHERE savings_account_id = (SELECT id FROM savings_accounts WHERE client_id = ? LIMIT 1)
          AND status = 'completed'
        ORDER BY created_at DESC LIMIT 1`,
      [clientId]
    );
    if (lastRows.length) lastContributionDate = lastRows[0].created_at;
  }

  // Shares
  const [shRows] = await db.query(
    `SELECT shares_held, total_invested FROM share_holdings WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  const shares = shRows[0] || null;

  // Loans
  const [loanRows] = await db.query(
    `SELECT id, principal, total_repayable, amount_repaid, status
       FROM loans WHERE client_id = ? AND status IN ('active','overdue') ORDER BY id DESC LIMIT 1`,
    [clientId]
  );
  const loan = loanRows[0] || null;
  let nextPayment = null;
  if (loan) {
    const [npRows] = await db.query(
      `SELECT due_date, amount_due FROM loan_payments
        WHERE loan_id = ? AND status IN ('pending','partial')
        ORDER BY due_date ASC LIMIT 1`,
      [loan.id]
    );
    if (npRows.length) nextPayment = npRows[0];
  }

  // Chama
  let chama = null;
  if (client.chama_id) {
    const [chRows] = await db.query(
      `SELECT name, code FROM chamas WHERE id = ? LIMIT 1`,
      [client.chama_id]
    );
    if (chRows.length) {
      chama = chRows[0];
      const period = new Date().toISOString().slice(0, 7);
      const [contribRows] = await db.query(
        `SELECT amount_due, amount_paid, status FROM chama_contributions
          WHERE chama_id = ? AND client_id = ? AND period = ? LIMIT 1`,
        [client.chama_id, clientId, period]
      );
      chama.contribution = contribRows[0] || null;
    }
  }

  return { client, savings, shares, loan, nextPayment, chama, weeklyContribution, lastContributionDate };
}

// -----------------------------------------------------------------
// Render email
// -----------------------------------------------------------------
function renderDigest(d) {
  const name = firstName(d.client.full_name);
  const savingsLines = d.savings
    ? `<p style="margin:0 0 6px">Current balance: <strong>KES ${fmtMoney(d.savings.balance)}</strong></p>
       <p style="margin:0 0 6px">Contributed this week: <strong>KES ${fmtMoney(d.weeklyContribution)}</strong></p>
       ${d.lastContributionDate ? `<p style="margin:0;color:#718096;font-size:13px">Last contribution: ${fmtDate(d.lastContributionDate)}</p>` : ''}`
    : '<p style="margin:0;color:#718096">No savings account yet.</p>';

  const sharesLines = d.shares
    ? `<p style="margin:0">Shares held: <strong>${d.shares.shares_held}</strong> (KES ${fmtMoney(d.shares.total_invested)})</p>`
    : '<p style="margin:0;color:#718096">No shares yet.</p>';

  let loansSection = '';
  if (d.loan) {
    const outstanding = Number(d.loan.total_repayable) - Number(d.loan.amount_repaid);
    loansSection = `
      <h2 style="margin:24px 0 8px;font-size:15px;color:#0B1F3A">Loans</h2>
      <p style="margin:0 0 6px">Outstanding: <strong>KES ${fmtMoney(outstanding)}</strong></p>
      ${d.nextPayment ? `<p style="margin:0;color:#718096;font-size:13px">Next payment: ${fmtDate(d.nextPayment.due_date)} (KES ${fmtMoney(d.nextPayment.amount_due)})</p>` : ''}
    `;
  }

  let chamaSection = '';
  if (d.chama) {
    chamaSection = `
      <h2 style="margin:24px 0 8px;font-size:15px;color:#0B1F3A">Chama</h2>
      <p style="margin:0 0 6px">Group: <strong>${escapeHtml(d.chama.name)}</strong></p>
      ${d.chama.contribution ? `<p style="margin:0;color:#718096;font-size:13px">This month's contribution: KES ${fmtMoney(d.chama.contribution.amount_paid)} / ${fmtMoney(d.chama.contribution.amount_due)} (${escapeHtml(d.chama.contribution.status)})</p>` : ''}
    `;
  }

  const text = `
Hi ${escapeHtml(name)},

Here's your Zaria SACCO summary for the past week.

SAVINGS
${d.savings ? `  Balance: KES ${fmtMoney(d.savings.balance)}\n  This week: KES ${fmtMoney(d.weeklyContribution)}` : '  No account yet'}

SHARES
${d.shares ? `  ${d.shares.shares_held} shares (KES ${fmtMoney(d.shares.total_invested)})` : '  None yet'}
${d.loan ? `\nLOANS\n  Outstanding: KES ${fmtMoney(Number(d.loan.total_repayable) - Number(d.loan.amount_repaid))}\n${d.nextPayment ? `  Next: ${fmtDate(d.nextPayment.due_date)} (KES ${fmtMoney(d.nextPayment.amount_due)})` : ''}` : ''}
${d.chama ? `\nCHAMA\n  ${d.chama.name}\n${d.chama.contribution ? `  This month: KES ${fmtMoney(d.chama.contribution.amount_paid)}/${fmtMoney(d.chama.contribution.amount_due)}` : ''}` : ''}

View your dashboard: https://zariauhai.com/client/dashboard

— Zaria Uhai SACCO
  info@zariauhai.com
`.trim();

  const html = `
<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#2A3342;line-height:1.5">
  <h1 style="margin:0 0 16px;font-size:20px;color:#0B1F3A">Your Zaria week in review</h1>
  <p style="margin:0 0 20px">Hi ${escapeHtml(name)}, here's your summary for the past week.</p>

  <h2 style="margin:0 0 8px;font-size:15px;color:#0B1F3A">Savings</h2>
  ${savingsLines}

  <h2 style="margin:24px 0 8px;font-size:15px;color:#0B1F3A">Shares</h2>
  ${sharesLines}
  ${loansSection}
  ${chamaSection}

  <p style="margin:24px 0 0">
    <a href="https://zariauhai.com/client/dashboard" style="display:inline-block;background:#0B1F3A;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">View your dashboard</a>
  </p>

  <hr style="margin:32px 0 16px;border:none;border-top:1px solid #E5E3DF">
  <p style="font-size:12px;color:#718096;margin:0">
    Zaria Uhai SACCO · <a href="mailto:info@zariauhai.com" style="color:#718096">info@zariauhai.com</a><br>
    You're receiving this because you have an active account.
  </p>
</body></html>
`.trim();

  // Collapse 3+ blank lines to max 2
  const cleanText = text.replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleanText, html, subject: 'Your Zaria weekly summary' };
}

// -----------------------------------------------------------------
// Main
// -----------------------------------------------------------------
(async function main() {
  console.log('[weekly-digest] start ' + new Date().toISOString());
  if (DRY_RUN) console.log('[weekly-digest] DRY RUN — no emails will be sent');

  try {
    const [clients] = await db.query(
      `SELECT id FROM clients WHERE status = 'active' ORDER BY id`
    );
    console.log('[weekly-digest] active clients: ' + clients.length);

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const c of clients) {
      try {
        const d = await buildDigest(c.id);
        if (!d || !d.client.email) { skipped++; continue; }

        const rendered = renderDigest(d);

        if (DRY_RUN) {
          console.log('');
          console.log('═══ ' + d.client.full_name + ' <' + d.client.email + '> ═══');
          console.log(rendered.text);
          sent++;
        } else {
          await email.send({
            to: d.client.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          });
          sent++;
          console.log('[weekly-digest] sent to ' + d.client.full_name + ' <' + d.client.email + '>');
        }
      } catch (err) {
        failed++;
        console.error('[weekly-digest] failed for client ' + c.id + ': ' + err.message);
      }
    }

    console.log('');
    console.log('[weekly-digest] done — sent=' + sent + ' skipped=' + skipped + ' failed=' + failed);
  } catch (err) {
    console.error('[weekly-digest] FATAL:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();
