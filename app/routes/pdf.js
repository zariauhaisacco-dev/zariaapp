const express = require('express');
const db = require('../db');
const loans = require('../services/loans');
const pdf = require('../services/pdf');
const audit = require('../services/audit');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

// Avoid trying to write a JSON error after the PDF stream has started.
// Once res.headersSent is true, the only correct move is to log and let
// the (truncated) response finish.
function safeError(res, status, message) {
  if (res.headersSent) {
    console.error('[pdf] error after headers sent:', message);
    return;
  }
  res.status(status).json({ error: message });
}

// Verify the requester may access the target client's PDFs.
// Admin: always. Client: only their own.
async function verifyPdfAccess(req, targetClientId) {
  if (req.user.role === 'admin') return true;
  if (req.user.role === 'client') {
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    return cl.length > 0 && cl[0].id === targetClientId;
  }
  return false;
}

// ---------------------------------------------------------------
// GET /api/receipts/:transactionId — receipt for one repayment
// Access: admin (any) or the owning client
// ---------------------------------------------------------------
router.get('/receipts/:transactionId', async (req, res) => {
  try {
    const txId = Number(req.params.transactionId);
    const [rows] = await db.query(
      `SELECT t.*, l.client_id AS loan_client_id, l.total_repayable, l.amount_repaid,
              l.status AS loan_status,
              c.full_name AS client_name, c.phone AS client_phone,
              u.email AS client_email
         FROM transactions t
         JOIN loans l ON l.id = t.loan_id
         JOIN clients c ON c.id = l.client_id
         JOIN users u ON u.id = c.user_id
        WHERE t.id = ? AND t.type = 'repayment'
        LIMIT 1`,
      [txId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Receipt not found' });
    const t = rows[0];

    // Access check
    const allowed = await verifyPdfAccess(req, t.loan_client_id);
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });

    const outstanding = Number(t.total_repayable) - Number(t.amount_repaid);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="receipt-' + txId + '.pdf"');

    pdf.streamReceipt(res, {
      transaction_id: t.id,
      amount: Number(t.amount),
      created_at: t.created_at,
      loan_id: t.loan_id,
      client_name: t.client_name,
      client_phone: t.client_phone,
      mpesa_receipt: t.mpesa_receipt,
      reference: t.reference,
      recorded_by_name: 'Zaria Admin',
      total_repayable: Number(t.total_repayable),
      amount_repaid: Number(t.amount_repaid),
      outstanding: outstanding,
      loan_status: t.loan_status,
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: 'pdf.receipt_generated',
      entityType: 'transaction',
      entityId: txId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  } catch (err) {
    console.error('[pdf receipt]', err.message);
    safeError(res, 500, 'Could not generate receipt');
  }
});

// ---------------------------------------------------------------
// GET /api/statements/:loanId — full statement for one loan
// Access: admin or the owning client
// ---------------------------------------------------------------
router.get('/statements/:loanId', async (req, res) => {
  try {
    const loanId = Number(req.params.loanId);
    const loan = await loans.getLoanById(loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    // Access check
    const allowed = await verifyPdfAccess(req, loan.client_id);
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });

    const state = await loans.computeLoanState(loanId);
    const transactions = await loans.getTransactions(loanId);
    const [clientRow] = await db.query(
      'SELECT c.full_name, c.phone, u.email FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ?',
      [loan.client_id]
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="statement-loan-' + loanId + '.pdf"');

    pdf.streamStatement(res, {
      client: {
        full_name: clientRow[0] ? clientRow[0].full_name : loan.client_name,
        phone: clientRow[0] ? clientRow[0].phone : loan.client_phone,
        email: clientRow[0] ? clientRow[0].email : '',
      },
      period_from: loan.created_at,
      period_to: new Date(),
      totals: {
        borrowed: Number(loan.principal),
        repaid: Number(loan.amount_repaid),
        outstanding: state.summary.outstanding,
      },
      loans: [{
        id: loan.id,
        principal: Number(loan.principal),
        interest_rate: Number(loan.interest_rate),
        term_months: loan.term_months,
        total_repayable: Number(loan.total_repayable),
        amount_repaid: Number(loan.amount_repaid),
        status: loan.status,
        disbursed_at: loan.disbursed_at,
        created_at: loan.created_at,
        transactions: transactions.map(t => ({
          created_at: t.created_at,
          type: t.type,
          amount: Number(t.amount),
          mpesa_receipt: t.mpesa_receipt,
          reference: t.reference,
        })),
      }],
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: 'pdf.statement_generated',
      entityType: 'loan',
      entityId: loanId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  } catch (err) {
    console.error('[pdf statement]', err.message);
    safeError(res, 500, 'Could not generate statement');
  }
});

// ---------------------------------------------------------------
// GET /api/pdf/contributions?year=YYYY|all — savings contributions
// Access: admin (any) or the owning client
// ---------------------------------------------------------------
router.get('/contributions', async (req, res) => {
  try {
    // Resolve client ID from user role
    let clientId;
    if (req.user.role === 'admin') {
      // Admin must pass ?client_id=
      clientId = Number(req.query.client_id);
      if (!clientId) return res.status(400).json({ error: 'client_id required for admin' });
    } else {
      const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
      if (!cl.length) return res.status(404).json({ error: 'Client not found' });
      clientId = cl[0].id;
    }

    // Load client + savings account
    const [clientRows] = await db.query(
      'SELECT c.id, c.full_name, c.phone, u.email FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ? LIMIT 1',
      [clientId]
    );
    if (!clientRows.length) return res.status(404).json({ error: 'Client not found' });
    const client = clientRows[0];

    const [accountRows] = await db.query(
      'SELECT id, account_number, balance FROM savings_accounts WHERE client_id = ? LIMIT 1',
      [clientId]
    );
    if (!accountRows.length) return res.status(404).json({ error: 'No savings account' });
    const account = accountRows[0];

    // Parse year filter
    const yearParam = req.query.year || 'all';
    let yearFilter = null;
    let periodLabel;
    if (yearParam === 'all') {
      periodLabel = 'All years';
    } else {
      yearFilter = Number(yearParam);
      if (!Number.isInteger(yearFilter) || yearFilter < 2020 || yearFilter > 2100) {
        return res.status(400).json({ error: 'Invalid year' });
      }
      periodLabel = '1 Jan ' + yearFilter + ' – 31 Dec ' + yearFilter;
    }

    // Load transactions (reuse the same query style as /api/me/savings/monthly)
    const [txRows] = await db.query(
      `SELECT id, amount, reference, notes, created_at
         FROM savings_transactions
        WHERE savings_account_id = ?
          AND status = 'completed'
        ORDER BY created_at ASC`,
      [account.id]
    );

    // Group by year → month
    const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const byYear = {};
    txRows.forEach(function (r) {
      const d = new Date(r.created_at);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      if (yearFilter && y !== yearFilter) return;
      if (!byYear[y]) {
        byYear[y] = {
          year: y,
          total: 0,
          months: Array.from({ length: 12 }, function (_, i) {
            return { month: i + 1, label: MONTH_LABELS[i], amount: 0, count: 0, refs: [] };
          }),
        };
      }
      byYear[y].months[m].amount += Number(r.amount);
      byYear[y].months[m].count += 1;
      if (r.reference) byYear[y].months[m].refs.push(r.reference);
      byYear[y].total += Number(r.amount);
    });

    const years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    const yearsOut = years.map(function (y) { return byYear[y]; });

    const grandTotal = yearsOut.reduce(function (s, yr) { return s + yr.total; }, 0);
    const totalCount = txRows.filter(function (r) {
      if (!yearFilter) return true;
      return new Date(r.created_at).getUTCFullYear() === yearFilter;
    }).length;

    // Stream PDF
    res.setHeader('Content-Type', 'application/pdf');
    const fname = 'zaria-contributions-' + account.account_number +
                  (yearFilter ? '-' + yearFilter : '-all') + '.pdf';
    res.setHeader('Content-Disposition', 'inline; filename="' + fname + '"');

    pdf.streamContributionsStatement(res, {
      client: {
        full_name: client.full_name,
        phone: client.phone,
        email: client.email || '',
        account_number: account.account_number,
      },
      period_label: periodLabel,
      totals: {
        total: grandTotal,
        count: totalCount,
        balance: Number(account.balance),
      },
      years: yearsOut,
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: 'pdf.contributions_generated',
      entityType: 'client',
      entityId: clientId,
      newValues: { year: yearParam, total: grandTotal, count: totalCount },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  } catch (err) {
    console.error('[pdf contributions]', err.message);
    safeError(res, 500, 'Could not generate contributions statement');
  }
});

// ---------------------------------------------------------------
// GET /api/agreements/:loanId — loan agreement
// Access: admin or the owning client
// ---------------------------------------------------------------
router.get('/agreements/:loanId', async (req, res) => {
  try {
    const loanId = Number(req.params.loanId);
    const loan = await loans.getLoanById(loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const allowed = await verifyPdfAccess(req, loan.client_id);
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });

    const schedule = await loans.getSchedule(loanId);
    const [clientRow] = await db.query(
      'SELECT c.full_name, c.phone, c.national_id FROM clients c WHERE c.id = ?',
      [loan.client_id]
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="agreement-loan-' + loanId + '.pdf"');

    pdf.streamLoanAgreement(res, {
      client: {
        full_name: clientRow[0] ? clientRow[0].full_name : loan.client_name,
        phone: clientRow[0] ? clientRow[0].phone : loan.client_phone,
        national_id: clientRow[0] ? clientRow[0].national_id : null,
      },
      loan: {
        id: loan.id,
        principal: Number(loan.principal),
        interest_rate: Number(loan.interest_rate),
        term_months: loan.term_months,
        total_repayable: Number(loan.total_repayable),
        purpose: loan.purpose,
        approved_at: loan.approved_at,
        created_at: loan.created_at,
      },
      schedule: schedule.map(s => ({
        installment_no: s.installment_no,
        amount_due: Number(s.amount_due),
        due_date: s.due_date,
      })),
    });
  } catch (err) {
    console.error('[pdf agreement]', err.message);
    safeError(res, 500, 'Could not generate agreement');
  }
});


// ---------------------------------------------------------------
// GET /api/certificate/:clientId — Share certificate PDF
// Access: admin or the owning client
// ---------------------------------------------------------------
router.get('/certificate/:clientId', async (req, res) => {
  try {
    const clientId = Number(req.params.clientId);

    // Access check
    const allowed = await verifyPdfAccess(req, clientId);
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });

    const shares = require('../services/shares');
    const holding = await shares.getHoldingForClient(clientId);
    if (!holding) return res.status(404).json({ error: 'No shareholding found' });

    const config = await shares.getConfig();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="share-certificate-' + clientId + '.pdf"');

    pdf.streamShareCertificate(res, {
      certificate_number: 'SC-' + String(clientId).padStart(6, '0'),
      full_name: holding.full_name,
      phone: holding.phone,
      shares_held: holding.shares_held,
      par_value: config.par_value,
      total_value: holding.shares_held * config.par_value,
      issued_at: new Date(),
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: 'pdf.share_certificate_generated',
      entityType: 'client',
      entityId: clientId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  } catch (err) {
    console.error('[pdf certificate]', err.message);
    safeError(res, 500, 'Could not generate certificate');
  }
});

module.exports = router;
