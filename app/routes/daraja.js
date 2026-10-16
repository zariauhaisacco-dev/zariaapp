/*
 * Zaria — Daraja routes
 *
 * POST /api/daraja/stk-push   — initiate M-Pesa STK Push (client auth)
 * POST /api/daraja/callback   — receive STK Push result (public, verified)
 *
 * Callback verification: we do NOT trust the callback body alone. Instead
 * we extract the CheckoutRequestID, call stkQuery() to confirm with Daraja,
 * and only then record the payment.
 */

const express = require('express');
const Joi = require('joi');
const db = require('../db');
const audit = require('../services/audit');
const daraja = require('../services/daraja');
const loans = require('../services/loans');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

    out.token_call_status = r.status;
    out.token_call_content_type = r.headers.get('content-type');
    const body = await r.text();
    out.token_call_body_head = body.slice(0, 200);
  } catch (err) {
    out.token_call_error = err.message;
  }

  res.json(out);
});

// ---------------------------------------------------------------
// POST /stk-push — client initiates payment for a loan
// ---------------------------------------------------------------
const stkSchema = Joi.object({
  loan_id: Joi.number().integer().positive().required(),
  phone: Joi.string().pattern(/^2547\d{8}$/).required(),
  amount: Joi.number().positive().max(500000).required(),
});

router.post('/stk-push', authenticate, async (req, res) => {
  if (!daraja.isConfigured()) {
    return res.status(503).json({ error: 'M-Pesa not configured' });
  }

  const { error, value } = stkSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    // Verify the client owns this loan
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client not found' });

    const [loansRows] = await db.query(
      'SELECT id, client_id, status FROM loans WHERE id = ? LIMIT 1',
      [value.loan_id]
    );
    if (!loansRows.length) return res.status(404).json({ error: 'Loan not found' });
    if (loansRows[0].client_id !== cl[0].id) {
      return res.status(403).json({ error: 'Not your loan' });
    }
    if (!['active', 'overdue'].includes(loansRows[0].status)) {
      return res.status(400).json({ error: 'Loan is not active' });
    }

    const result = await daraja.stkPush({
      phone: value.phone,
      amount: value.amount,
      accountReference: 'LOAN-' + value.loan_id,
      description: 'Loan repayment',
    });

    // Record the request as pending
    await db.query(
      `INSERT INTO daraja_requests
        (client_id, loan_id, checkout_request_id, merchant_request_id,
         phone, amount, direction, status)
       VALUES (?, ?, ?, ?, ?, ?, 'stk_push', 'pending')`,
      [cl[0].id, value.loan_id, result.checkoutRequestId, result.merchantRequestId,
       value.phone, value.amount]
    );

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'client',
      action: 'daraja.stk_push_initiated',
      entityType: 'loan',
      entityId: value.loan_id,
      newValues: { amount: value.amount, checkout_request_id: result.checkoutRequestId },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({
      ok: true,
      checkout_request_id: result.checkoutRequestId,
      message: 'Enter your M-Pesa PIN on your phone.',
    });
  } catch (err) {
    console.error('[daraja stk-push]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// POST /callback — receive STK Push result from Daraja
// PUBLIC — no session. Verified via stkQuery.
// ---------------------------------------------------------------
router.post('/callback', async (req, res) => {
  // Respond immediately (Daraja expects a fast 200)
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const body = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!body) return;

    const checkoutRequestId = body.CheckoutRequestID;
    const resultCode = body.ResultCode;
    const resultDesc = body.ResultDesc;

    // Look up the pending request
    const [rows] = await db.query(
      'SELECT id, client_id, loan_id, phone, amount FROM daraja_requests WHERE checkout_request_id = ? LIMIT 1',
      [checkoutRequestId]
    );
    if (!rows.length) {
      console.warn('[daraja callback] unknown checkout:', checkoutRequestId);
      return;
    }
    const reqRow = rows[0];

    // Store the raw callback for audit
    await db.query(
      'UPDATE daraja_requests SET raw_callback = ? WHERE id = ?',
      [JSON.stringify(req.body), reqRow.id]
    );

    // If ResultCode is not 0, we can trust the failure (no money moved)
    if (Number(resultCode) !== 0) {
      const cls = daraja.classifyResultCode(resultCode);
      await db.query(
        'UPDATE daraja_requests SET status = ?, result_code = ?, result_desc = ? WHERE id = ?',
        [cls, resultCode, resultDesc, reqRow.id]
      );
      return;
    }

    // Success case — VERIFY with Daraja before trusting the callback
    let verified = false;
    let mpesaReceipt = null;
    try {
      const q = await daraja.stkQuery({ checkoutRequestId });
      if (q.resultCode === 0) {
        verified = true;
        // Extract receipt from CallbackMetadata if present
        const items = body.CallbackMetadata && body.CallbackMetadata.Item;
        if (Array.isArray(items)) {
          const rec = items.find(i => i.Name === 'MpesaReceiptNumber');
          if (rec) mpesaReceipt = rec.Value;
        }
      }
    } catch (e) {
      console.error('[daraja callback verify]', e.message);
    }

    if (!verified) {
      await db.query(
        'UPDATE daraja_requests SET status = ?, result_code = ?, result_desc = ? WHERE id = ?',
        ['failed', resultCode, 'Callback failed verification', reqRow.id]
      );
      return;
    }

    // Record the payment against the loan
    const paymentResult = await loans.recordPayment({
      loanId: reqRow.loan_id,
      amount: Number(reqRow.amount),
      mpesaReceipt: mpesaReceipt,
      reference: 'MPESA-STK',
      notes: 'M-Pesa STK Push',
      recordedBy: null,
    });

    await db.query(
      `UPDATE daraja_requests
          SET status = 'success', result_code = 0, result_desc = ?, mpesa_receipt = ?
        WHERE id = ?`,
      [resultDesc, mpesaReceipt, reqRow.id]
    );

    await audit.log({
      actorRole: 'system',
      action: 'daraja.payment_recorded',
      entityType: 'loan',
      entityId: reqRow.loan_id,
      newValues: {
        amount: reqRow.amount,
        mpesa_receipt: mpesaReceipt,
        checkout_request_id: checkoutRequestId,
      },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    console.log('[daraja callback] payment recorded for loan', reqRow.loan_id);
  } catch (err) {
    console.error('[daraja callback]', err.message);
  }
});

module.exports = router;
