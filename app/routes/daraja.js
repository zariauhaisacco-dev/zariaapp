/*
 * Zaria — Daraja routes
 */

const express = require('express');
const Joi = require('joi');
const db = require('../db');
const audit = require('../services/audit');
const daraja = require('../services/daraja');
const loans = require('../services/loans');
const reconcile = require('../services/daraja-reconcile');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------
// POST /stk-push
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

    await db.query(
      "INSERT INTO daraja_requests (client_id, loan_id, checkout_request_id, merchant_request_id, phone, amount, direction, status) VALUES (?, ?, ?, ?, ?, ?, 'stk_push', 'pending')",
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
// POST /stk-push-savings — client saves via M-Pesa
// ---------------------------------------------------------------
const stkSavingsSchema = Joi.object({
  phone: Joi.string().pattern(/^2547\d{8}$/).required(),
  amount: Joi.number().integer().min(100).max(500000).required(),
});

router.post('/stk-push-savings', authenticate, async (req, res) => {
  if (!daraja.isConfigured()) {
    return res.status(503).json({ error: 'M-Pesa not configured' });
  }

  const { error, value } = stkSavingsSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client not found' });
    const clientId = cl[0].id;

    // Auto-create savings account if missing
    const savings = require('../services/savings');
    let account = await savings.getAccountByClient(clientId);
    if (!account) {
      const newId = await savings.createAccountForClient(clientId);
      account = await savings.getAccountById(newId);
    }
    if (!account) {
      return res.status(500).json({ error: 'Could not open savings account' });
    }

    const result = await daraja.stkPush({
      phone: value.phone,
      amount: value.amount,
      accountReference: 'SAVE-' + clientId,
      description: 'Savings deposit',
    });

    await db.query(
      "INSERT INTO daraja_requests (client_id, savings_account_id, checkout_request_id, merchant_request_id, phone, amount, direction, status) VALUES (?, ?, ?, ?, ?, ?, 'stk_push', 'pending')",
      [clientId, account.id, result.checkoutRequestId, result.merchantRequestId,
       value.phone, value.amount]
    );

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'client',
      action: 'daraja.stk_push_savings_initiated',
      entityType: 'savings_account',
      entityId: account.id,
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
    console.error('[daraja stk-push-savings]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// GET /status/:checkoutId
// ---------------------------------------------------------------
router.get('/status/:checkoutId', authenticate, async (req, res) => {
  try {
    const checkoutId = String(req.params.checkoutId);
    const [rows] = await db.query(
      'SELECT status, result_code, result_desc, mpesa_receipt, amount FROM daraja_requests WHERE checkout_request_id = ? LIMIT 1',
      [checkoutId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Request not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[daraja status]', err.message);
    res.status(500).json({ error: 'Could not load status' });
  }
});

// ---------------------------------------------------------------
// POST /callback
// ---------------------------------------------------------------
router.post('/callback', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const body = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!body) return;

    const checkoutRequestId = body.CheckoutRequestID;
    const resultCode = body.ResultCode;
    const resultDesc = body.ResultDesc;

    const [rows] = await db.query(
      'SELECT id, client_id, loan_id, savings_account_id, phone, amount FROM daraja_requests WHERE checkout_request_id = ? LIMIT 1',
      [checkoutRequestId]
    );
    if (!rows.length) {
      console.warn('[daraja callback] unknown checkout:', checkoutRequestId);
      return;
    }
    const reqRow = rows[0];

    await db.query(
      'UPDATE daraja_requests SET raw_callback = ? WHERE id = ?',
      [JSON.stringify(req.body), reqRow.id]
    );

    if (Number(resultCode) !== 0) {
      const cls = daraja.classifyResultCode(resultCode);
      await db.query(
        'UPDATE daraja_requests SET status = ?, result_code = ?, result_desc = ? WHERE id = ?',
        [cls, resultCode, resultDesc, reqRow.id]
      );
      return;
    }

    // Extract the receipt directly from the callback body.
    // Daraja's stkQuery endpoint has a known race condition where it
    // returns null/stale data for a few seconds after a successful push.
    // Trust the body when it contains a valid MpesaReceiptNumber.
    let mpesaReceipt = null;
    let verified = false;

    const items = body.CallbackMetadata && body.CallbackMetadata.Item;
    if (Array.isArray(items)) {
      const rec = items.find(i => i.Name === 'MpesaReceiptNumber');
      if (rec && rec.Value) {
        mpesaReceipt = String(rec.Value);
        verified = true;
      }
    }

    if (!verified) {
      try {
        const q = await daraja.stkQuery({ checkoutRequestId });
        if (q.resultCode === 0 && q.raw && q.raw.MpesaReceiptNumber) {
          mpesaReceipt = q.raw.MpesaReceiptNumber;
          verified = true;
        }
      } catch (e) {
        console.error('[daraja callback verify]', e.message);
      }
    }

    if (!verified) {
      await reconcile.recordFailure(reqRow, resultCode, 'Callback missing MpesaReceiptNumber');
      return;
    }

    try {
      await reconcile.recordSuccess(reqRow, mpesaReceipt, resultDesc, {
        source: 'callback',
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (e) {
      console.error('[daraja callback] recordSuccess failed:', e.message);
    }
  } catch (err) {
    console.error('[daraja callback]', err.message);
  }
});

module.exports = router;
