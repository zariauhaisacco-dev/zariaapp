/*
 * Zaria — Dividends service
 *
 * Flow:
 *   1. Admin creates a declaration (draft) — dividend rate per share + FY
 *   2. Admin previews distribution — computes each member's payout
 *   3. Admin distributes — creates payout rows and credits savings
 *
 * Tax: 5% KRA withholding on dividends for Kenyan residents.
 */

const db = require('../db');
const savings = require('./savings');

const TAX_RATE = 0.05; // 5% KRA withholding

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}

// ---------------------------------------------------------------
// Preview: given a rate per share, compute per-member payouts
// ---------------------------------------------------------------

async function previewDistribution(dividendPerShare) {
  const rate = Number(dividendPerShare);
  if (!(rate > 0)) throw new Error('Dividend per share must be positive');

  const [rows] = await db.query(
    `SELECT sh.client_id, sh.shares_held,
            c.full_name, c.phone
       FROM share_holdings sh
       JOIN clients c ON c.id = sh.client_id
      WHERE sh.shares_held > 0
      ORDER BY sh.shares_held DESC`
  );

  let totalShares = 0;
  let totalGross = 0;
  let totalTax = 0;
  let totalNet = 0;

  const payouts = rows.map(function (r) {
    const shares = r.shares_held;
    const gross = round2(shares * rate);
    const tax = round2(gross * TAX_RATE);
    const net = round2(gross - tax);

    totalShares += shares;
    totalGross = round2(totalGross + gross);
    totalTax = round2(totalTax + tax);
    totalNet = round2(totalNet + net);

    return {
      client_id: r.client_id,
      full_name: r.full_name,
      phone: r.phone,
      shares_held: shares,
      gross_amount: gross,
      withholding_tax: tax,
      net_amount: net,
    };
  });

  return {
    dividend_per_share: rate,
    tax_rate: TAX_RATE,
    total_shares: totalShares,
    member_count: payouts.length,
    total_gross: totalGross,
    total_tax: totalTax,
    total_net: totalNet,
    payouts: payouts,
  };
}

// ---------------------------------------------------------------
// Create a declaration (draft)
// ---------------------------------------------------------------

async function createDeclaration({ financialYear, dividendPerShare, notes, createdBy }) {
  const year = String(financialYear || '').trim();
  if (!/^\d{4}(\/\d{4})?$/.test(year)) {
    throw new Error('Financial year must be YYYY or YYYY/YYYY');
  }

  const rate = round4(dividendPerShare);
  if (!(rate > 0)) throw new Error('Dividend per share must be positive');

  // Check for existing
  const [existing] = await db.query(
    'SELECT id FROM dividend_declarations WHERE financial_year = ? LIMIT 1',
    [year]
  );
  if (existing.length) {
    throw new Error('A declaration already exists for ' + year);
  }

  const preview = await previewDistribution(rate);

  const [result] = await db.query(
    `INSERT INTO dividend_declarations
      (financial_year, dividend_per_share, total_shares_at_declaration, total_payout, status, notes, created_by)
     VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
    [year, rate, preview.total_shares, preview.total_gross, notes || null, createdBy]
  );

  return {
    declarationId: result.insertId,
    financial_year: year,
    preview: preview,
  };
}

// ---------------------------------------------------------------
// Get one declaration with all payouts
// ---------------------------------------------------------------

async function getDeclaration(declarationId) {
  const [rows] = await db.query(
    `SELECT dd.*, u.email AS created_by_email
       FROM dividend_declarations dd
       LEFT JOIN users u ON u.id = dd.created_by
      WHERE dd.id = ?
      LIMIT 1`,
    [declarationId]
  );
  if (!rows.length) return null;
  const decl = rows[0];

  const [payouts] = await db.query(
    `SELECT dp.id, dp.client_id, dp.shares_at_declaration, dp.dividend_per_share,
            dp.gross_amount, dp.withholding_tax, dp.net_amount, dp.status,
            dp.credited_to_savings, dp.paid_at, dp.reference,
            c.full_name, c.phone
       FROM dividend_payouts dp
       JOIN clients c ON c.id = dp.client_id
      WHERE dp.declaration_id = ?
      ORDER BY dp.gross_amount DESC`,
    [declarationId]
  );

  return { declaration: decl, payouts: payouts };
}

// ---------------------------------------------------------------
// List declarations (summary)
// ---------------------------------------------------------------

async function listDeclarations() {
  const [rows] = await db.query(
    `SELECT dd.id, dd.financial_year, dd.dividend_per_share,
            dd.total_shares_at_declaration, dd.total_payout, dd.status,
            dd.declared_at, dd.distributed_at, dd.created_at,
            (SELECT COUNT(*) FROM dividend_payouts dp WHERE dp.declaration_id = dd.id) AS member_count,
            (SELECT COUNT(*) FROM dividend_payouts dp WHERE dp.declaration_id = dd.id AND dp.status = 'credited') AS credited_count
       FROM dividend_declarations dd
      ORDER BY dd.created_at DESC`
  );
  return rows;
}

// ---------------------------------------------------------------
// Distribute — creates payout rows and credits each member's savings
// ---------------------------------------------------------------

async function distributeDeclaration({ declarationId, creditToSavings, adminUserId }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Lock declaration
    const [decls] = await conn.query(
      'SELECT * FROM dividend_declarations WHERE id = ? FOR UPDATE',
      [declarationId]
    );
    if (!decls.length) throw new Error('Declaration not found');
    const decl = decls[0];
    if (decl.status !== 'draft' && decl.status !== 'declared') {
      throw new Error('Declaration is already ' + decl.status);
    }

    // Get all current members with shares
    const [holdings] = await conn.query(
      `SELECT sh.client_id, sh.shares_held
         FROM share_holdings sh
        WHERE sh.shares_held > 0`
    );
    if (!holdings.length) throw new Error('No shareholders to distribute to');

    // Insert payout rows (skip if already exists — idempotent)
    const payouts = [];
    for (const h of holdings) {
      const gross = round2(h.shares_held * Number(decl.dividend_per_share));
      const tax = round2(gross * TAX_RATE);
      const net = round2(gross - tax);

      const [insertResult] = await conn.query(
        `INSERT IGNORE INTO dividend_payouts
          (declaration_id, client_id, shares_at_declaration, dividend_per_share,
           gross_amount, withholding_tax, net_amount, status, credited_to_savings)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [declarationId, h.client_id, h.shares_held, decl.dividend_per_share,
         gross, tax, net, creditToSavings ? 1 : 0]
      );

      payouts.push({
        payoutId: insertResult.insertId,
        clientId: h.client_id,
        net: net,
        credited: insertResult.affectedRows > 0 ? false : true, // if IGNORE skipped, already exists
      });
    }

    await conn.query(
      `UPDATE dividend_declarations
          SET status = 'declared', declared_by = ?, declared_at = NOW()
        WHERE id = ?`,
      [adminUserId, declarationId]
    );

    await conn.commit();

    // Credit savings OUTSIDE the transaction (each credit is its own transaction)
    let credited = 0;
    let failed = 0;
    if (creditToSavings) {
      for (const p of payouts) {
        if (p.credited) continue; // was already there

        try {
          // Ensure member has a savings account
          let savAccount = await savings.getAccountByClient(p.clientId);
          if (!savAccount) {
            const accId = await savings.createAccountForClient(p.clientId);
            savAccount = await savings.getAccountById(accId);
          }

          const result = await savings.deposit({
            savingsAccountId: savAccount.id,
            amount: p.net,
            channel: 'system',
            reference: 'DIV-' + declarationId + '-' + p.clientId,
            notes: 'Dividend credit for FY ' + decl.financial_year,
            recordedBy: adminUserId,
          });

          await db.query(
            `UPDATE dividend_payouts
                SET status = 'credited', paid_at = NOW(),
                    savings_transaction_id = ?, reference = ?
              WHERE id = ?`,
            [result.transactionId, 'DIV-' + declarationId, p.payoutId]
          );
          credited++;
        } catch (err) {
          console.error('[dividend credit] client ' + p.clientId + ':', err.message);
          await db.query(
            `UPDATE dividend_payouts SET status = 'failed' WHERE id = ?`,
            [p.payoutId]
          );
          failed++;
        }
      }
    }

    await db.query(
      `UPDATE dividend_declarations
          SET status = 'distributed', distributed_at = NOW()
        WHERE id = ?`,
      [declarationId]
    );

    return {
      declarationId,
      totalPayouts: payouts.length,
      credited: credited,
      failed: failed,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Cancel a draft declaration
// ---------------------------------------------------------------

async function cancelDeclaration(declarationId) {
  const [rows] = await db.query(
    'SELECT id, status FROM dividend_declarations WHERE id = ? LIMIT 1',
    [declarationId]
  );
  if (!rows.length) throw new Error('Not found');
  if (rows[0].status === 'distributed') throw new Error('Cannot cancel a distributed declaration');

  await db.query(
    "UPDATE dividend_declarations SET status = 'cancelled' WHERE id = ?",
    [declarationId]
  );
}

// ---------------------------------------------------------------
// Client-facing: my dividend history
// ---------------------------------------------------------------

async function getClientDividends(clientId) {
  const [rows] = await db.query(
    `SELECT dp.id, dp.shares_at_declaration, dp.dividend_per_share,
            dp.gross_amount, dp.withholding_tax, dp.net_amount, dp.status,
            dp.credited_to_savings, dp.paid_at, dp.created_at,
            dd.financial_year, dd.status AS declaration_status
       FROM dividend_payouts dp
       JOIN dividend_declarations dd ON dd.id = dp.declaration_id
      WHERE dp.client_id = ?
      ORDER BY dp.created_at DESC`,
    [clientId]
  );

  const [totals] = await db.query(
    `SELECT
       COALESCE(SUM(dp.net_amount), 0) AS total_net,
       COALESCE(SUM(dp.gross_amount), 0) AS total_gross,
       COALESCE(SUM(dp.withholding_tax), 0) AS total_tax
       FROM dividend_payouts dp
      WHERE dp.client_id = ? AND dp.status IN ('credited','paid')`,
    [clientId]
  );

  return {
    payouts: rows,
    totals: {
      gross: Number(totals[0].total_gross),
      tax: Number(totals[0].total_tax),
      net: Number(totals[0].total_net),
    },
  };
}

module.exports = {
  previewDistribution,
  createDeclaration,
  getDeclaration,
  listDeclarations,
  distributeDeclaration,
  cancelDeclaration,
  getClientDividends,
};
