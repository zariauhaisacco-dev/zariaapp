/*
 * Zaria — Loan service
 *
 * All financial logic lives here. Endpoints call these functions; they never
 * touch the tables directly. Every write runs in a transaction.
 *
 * Money is handled as JS numbers for computation but persisted as DECIMAL(15,2).
 * Amounts are rounded to 2 decimal places at write time.
 */

const db = require('../db');

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function toDateOnly(d) {
  // Returns 'YYYY-MM-DD' in UTC
  return d.toISOString().slice(0, 10);
}

// Add N months to a date, clamping the day if needed (e.g. Jan 31 + 1 month = Feb 28)
function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1); // avoid overflow when moving months
  d.setUTCMonth(d.getUTCMonth() + months);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, daysInMonth));
  return d;
}

// ---------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------

/**
 * Build an equal-installments schedule for a loan.
 * Interest is flat (not compounding). Total repayable = principal + principal*rate.
 * Each installment has the same amount due, monthly, starting one month from today.
 */
function buildSchedule({ principal, interestRate, termMonths, startDate }) {
  const totalRepayable = round2(principal * (1 + interestRate));
  const installmentAmount = round2(totalRepayable / termMonths);

  // Adjust the last installment to absorb rounding drift
  const installments = [];
  let allocated = 0;
  for (let i = 1; i <= termMonths; i++) {
    let amount = installmentAmount;
    if (i === termMonths) amount = round2(totalRepayable - allocated);
    allocated = round2(allocated + amount);

    const dueDate = addMonths(startDate, i);
    installments.push({
      installmentNo: i,
      dueDate: toDateOnly(dueDate),
      amountDue: amount,
    });
  }

  return { totalRepayable, installments };
}

// ---------------------------------------------------------------
// Create a loan (status='pending')
// ---------------------------------------------------------------

async function createLoan({
  clientId,
  productId = null,
  principal,
  interestRate,
  termMonths,
  purpose = null,
  createdBy,
}) {
  principal = round2(principal);
  interestRate = Number(interestRate);
  termMonths = parseInt(termMonths, 10);

  if (!clientId || !createdBy) throw new Error('clientId and createdBy are required');
  if (!(principal > 0)) throw new Error('Principal must be positive');
  if (!(interestRate >= 0 && interestRate < 1)) throw new Error('Interest rate must be in [0,1)');
  if (!(termMonths >= 1 && termMonths <= 24)) throw new Error('Term must be 1-24 months');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [clientRows] = await conn.query(
      'SELECT id, status FROM clients WHERE id = ? FOR UPDATE',
      [clientId]
    );
    if (!clientRows.length) throw new Error('Client not found');
    if (clientRows[0].status !== 'active') throw new Error('Client is not active');

    // If productId provided, validate against product
    if (productId) {
      const [prodRows] = await conn.query(
        'SELECT id, min_amount, max_amount, active FROM loan_products WHERE id = ?',
        [productId]
      );
      if (!prodRows.length) throw new Error('Loan product not found');
      const p = prodRows[0];
      if (!p.active) throw new Error('Loan product is not active');
      if (principal < Number(p.min_amount) || principal > Number(p.max_amount)) {
        throw new Error('Principal is outside product range');
      }
    }

    const startDate = new Date();
    const { totalRepayable, installments } = buildSchedule({
      principal,
      interestRate,
      termMonths,
      startDate,
    });

    const [loanResult] = await conn.query(
      `INSERT INTO loans
        (client_id, product_id, principal, interest_rate, term_months,
         total_repayable, amount_repaid, status, purpose, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
      [clientId, productId, principal, interestRate, termMonths,
       totalRepayable, purpose, createdBy]
    );
    const loanId = loanResult.insertId;

    for (const inst of installments) {
      await conn.query(
        `INSERT INTO loan_payments
          (loan_id, installment_no, due_date, amount_due, amount_paid, status)
         VALUES (?, ?, ?, ?, 0, 'pending')`,
        [loanId, inst.installmentNo, inst.dueDate, inst.amountDue]
      );
    }

    await conn.commit();
    return { loanId, totalRepayable, installmentCount: installments.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Approve a loan (status='pending' -> 'approved')
// ---------------------------------------------------------------

async function approveLoan({ loanId, adminUserId }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT id, status FROM loans WHERE id = ? FOR UPDATE',
      [loanId]
    );
    if (!rows.length) throw new Error('Loan not found');
    if (rows[0].status !== 'pending') throw new Error('Loan is not pending');

    await conn.query(
      `UPDATE loans
          SET status = 'approved', approved_by = ?, approved_at = NOW()
        WHERE id = ?`,
      [adminUserId, loanId]
    );
    await conn.commit();
    return { loanId, status: 'approved' };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Disburse a loan (status='approved' -> 'active')
// ---------------------------------------------------------------

async function disburseLoan({
  loanId,
  adminUserId,
  reference = null,
  mpesaReceipt = null,
  notes = null,
}) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT id, client_id, principal, status FROM loans WHERE id = ? FOR UPDATE',
      [loanId]
    );
    if (!rows.length) throw new Error('Loan not found');
    const loan = rows[0];
    if (loan.status !== 'approved') throw new Error('Loan must be approved before disbursement');

    await conn.query(
      `UPDATE loans
          SET status = 'active', disbursed_at = NOW()
        WHERE id = ?`,
      [loanId]
    );

    await conn.query(
      `INSERT INTO transactions
        (loan_id, client_id, type, amount, mpesa_receipt, reference, status, notes, recorded_by)
       VALUES (?, ?, 'disbursement', ?, ?, ?, 'completed', ?, ?)`,
      [loanId, loan.client_id, loan.principal, mpesaReceipt, reference, notes, adminUserId]
    );

    await conn.commit();
    return { loanId, status: 'active' };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Record a repayment
//
// Allocates the amount across the oldest unpaid installments first.
// Supports partial payments per installment.
// If the loan is fully repaid, marks status='repaid'.
// ---------------------------------------------------------------

async function recordPayment({
  loanId,
  amount,
  mpesaReceipt = null,
  reference = null,
  notes = null,
  recordedBy = null,
}) {
  amount = round2(amount);
  if (!(amount > 0)) throw new Error('Amount must be positive');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [loanRows] = await conn.query(
      'SELECT id, client_id, total_repayable, amount_repaid, status FROM loans WHERE id = ? FOR UPDATE',
      [loanId]
    );
    if (!loanRows.length) throw new Error('Loan not found');
    const loan = loanRows[0];

    if (!['active', 'overdue'].includes(loan.status)) {
      throw new Error('Loan is not active — cannot accept repayment');
    }

    const totalRepayable = Number(loan.total_repayable);
    const alreadyPaid = Number(loan.amount_repaid);
    const remaining = round2(totalRepayable - alreadyPaid);

    if (amount > remaining + 0.01) {
      throw new Error(`Payment exceeds outstanding balance (${remaining.toFixed(2)})`);
    }

    // Fetch unpaid/partially paid installments, oldest first
    const [installments] = await conn.query(
      `SELECT id, installment_no, amount_due, amount_paid
         FROM loan_payments
        WHERE loan_id = ? AND status IN ('pending','partial','overdue')
        ORDER BY installment_no ASC
        FOR UPDATE`,
      [loanId]
    );

    let left = amount;
    for (const inst of installments) {
      if (left <= 0) break;
      const due = Number(inst.amount_due);
      const paid = Number(inst.amount_paid);
      const shortfall = round2(due - paid);
      const apply = round2(Math.min(left, shortfall));

      const newPaid = round2(paid + apply);
      const fullyPaid = newPaid >= due - 0.01;
      const newStatus = fullyPaid ? 'paid' : 'partial';

      await conn.query(
        `UPDATE loan_payments
            SET amount_paid = ?, status = ?, paid_at = ?
          WHERE id = ?`,
        [newPaid, newStatus, fullyPaid ? new Date() : null, inst.id]
      );

      left = round2(left - apply);
    }

    const newTotalRepaid = round2(alreadyPaid + amount);
    const fullyRepaid = newTotalRepaid >= totalRepayable - 0.01;

    await conn.query(
      `UPDATE loans
          SET amount_repaid = ?,
              status = ?,
              closed_at = ?
        WHERE id = ?`,
      [newTotalRepaid, fullyRepaid ? 'repaid' : loan.status, fullyRepaid ? new Date() : null, loanId]
    );

    await conn.query(
      `INSERT INTO transactions
        (loan_id, client_id, type, amount, mpesa_receipt, reference, status, notes, recorded_by)
       VALUES (?, ?, 'repayment', ?, ?, ?, 'completed', ?, ?)`,
      [loanId, loan.client_id, amount, mpesaReceipt, reference, notes, recordedBy]
    );

    await conn.commit();

    return {
      loanId,
      amountApplied: amount,
      newTotalRepaid,
      outstanding: round2(totalRepayable - newTotalRepaid),
      fullyRepaid,
      loanStatus: fullyRepaid ? 'repaid' : loan.status,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------

async function getLoanById(loanId) {
  const [rows] = await db.query(
    `SELECT l.*, c.full_name AS client_name, c.phone AS client_phone,
            p.name AS product_name
       FROM loans l
       JOIN clients c ON c.id = l.client_id
       LEFT JOIN loan_products p ON p.id = l.product_id
      WHERE l.id = ?`,
    [loanId]
  );
  return rows[0] || null;
}

async function getSchedule(loanId) {
  const [rows] = await db.query(
    `SELECT id, installment_no, due_date, amount_due, amount_paid, paid_at, status
       FROM loan_payments
      WHERE loan_id = ?
      ORDER BY installment_no ASC`,
    [loanId]
  );
  return rows;
}

async function getTransactions(loanId, limit = 50) {
  const [rows] = await db.query(
    `SELECT id, type, amount, mpesa_receipt, reference, status, notes, created_at
       FROM transactions
      WHERE loan_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [loanId, limit]
  );
  return rows;
}

/**
 * Returns a computed state summary for a loan.
 */
async function computeLoanState(loanId) {
  const loan = await getLoanById(loanId);
  if (!loan) return null;

  const schedule = await getSchedule(loanId);
  const totalRepayable = Number(loan.total_repayable);
  const amountRepaid = Number(loan.amount_repaid);
  const outstanding = round2(totalRepayable - amountRepaid);
  const progressPct = totalRepayable > 0
    ? Math.round((amountRepaid / totalRepayable) * 100)
    : 0;

  const next = schedule.find(s => s.status !== 'paid') || null;

  return {
    loan,
    schedule,
    summary: {
      totalRepayable,
      amountRepaid,
      outstanding,
      progressPct,
      nextPayment: next
        ? {
            installmentNo: next.installment_no,
            dueDate: next.due_date,
            amountDue: Number(next.amount_due),
            amountPaid: Number(next.amount_paid),
            amountRemaining: round2(Number(next.amount_due) - Number(next.amount_paid)),
          }
        : null,
    },
  };
}

/**
 * Cron helper: flag loans with pending installments past their due date.
 */
async function markOverduePayments() {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Flag installments past due
    const [r1] = await conn.query(
      `UPDATE loan_payments
          SET status = 'overdue'
        WHERE status = 'pending'
          AND due_date < CURDATE()`
    );

    // Flag loans that have any overdue payment and are still marked active
    const [r2] = await conn.query(
      `UPDATE loans l
          SET l.status = 'overdue'
        WHERE l.status = 'active'
          AND EXISTS (
            SELECT 1 FROM loan_payments lp
             WHERE lp.loan_id = l.id AND lp.status = 'overdue'
          )`
    );

    await conn.commit();
    return { installmentsFlagged: r1.affectedRows, loansFlagged: r2.affectedRows };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  buildSchedule,
  createLoan,
  approveLoan,
  disburseLoan,
  recordPayment,
  getLoanById,
  getSchedule,
  getTransactions,
  computeLoanState,
  markOverduePayments,
};
