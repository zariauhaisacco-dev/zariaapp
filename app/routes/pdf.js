const express = require('express');
const db = require('../db');
const loans = require('../services/loans');
const pdf = require('../services/pdf');
const audit = require('../services/audit');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

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
    let allowed = false;
    if (req.user.role === 'admin') allowed = true;
    if (req.user.role === 'client') {
      const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
      if (cl.length && cl[0].id === t.loan_client_id) allowed = true;
    }
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
    res.status(500).json({ error: 'Could not generate receipt' });
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
    let allowed = false;
    if (req.user.role === 'admin') allowed = true;
    if (req.user.role === 'client') {
      const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
      if (cl.length && cl[0].id === loan.client_id) allowed = true;
    }
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
    res.status(500).json({ error: 'Could not generate statement' });
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

    let allowed = false;
    if (req.user.role === 'admin') allowed = true;
    if (req.user.role === 'client') {
      const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
      if (cl.length && cl[0].id === loan.client_id) allowed = true;
    }
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
    res.status(500).json({ error: 'Could not generate agreement' });
  }
});


// ---------------------------------------------------------------
// GET /api/certificate/:clientId — Share certificate PDF
// Access: admin or the owning client
// ---------------------------------------------------------------
router.get('/certificate/:clientId', async (req, res) => {
  try {
    const clientId = Number(req.params.clientId);

    // Permission
    let allowed = false;
    if (req.user.role === 'admin') allowed = true;
    if (req.user.role === 'client') {
      const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
      if (cl.length && cl[0].id === clientId) allowed = true;
    }
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
    res.status(500).json({ error: 'Could not generate certificate' });
  }
});

module.exports = router;
