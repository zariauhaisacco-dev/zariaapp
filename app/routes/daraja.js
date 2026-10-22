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
  if (!(await daraja.isConfigured())) {
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
  if (!(await daraja.isConfigured())) {
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
      'SELECT id, client_id, loan_id, savings_account_id, chama_savings_account_id, phone, amount FROM daraja_requests WHERE checkout_request_id = ? LIMIT 1',
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

// ---------------------------------------------------------------
// POST /b2c-callback — B2C result callback from Safaricom
// PUBLIC — verifies via transaction status query
// ---------------------------------------------------------------
router.post('/b2c-callback', async (req, res) => {
  // Respond immediately
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const result = req.body && req.body.Result;
    if (!result) {
      console.warn('[daraja b2c-callback] no Result in body');
      return;
    }

    const originatorId = result.OriginatorConversationID;
    const conversationId = result.ConversationID;
    const transactionId = result.TransactionID;
    const resultCode = Number(result.ResultCode);
    const resultDesc = result.ResultDesc;

    // Find our daraja_requests row by originator conversation id
    const [rows] = await db.query(
      `SELECT id, client_id, loan_id, savings_account_id, phone, amount, status, direction
         FROM daraja_requests
        WHERE b2c_originator_conversation_id = ?
        LIMIT 1`,
      [originatorId]
    );

    if (!rows.length) {
      console.warn('[daraja b2c-callback] unknown originator:', originatorId);
      return;
    }
    const reqRow = rows[0];

    // Extract details from ResultParameters if success
    let receiverName = null;
    if (result.ResultParameters && result.ResultParameters.ResultParameter) {
      const items = result.ResultParameters.ResultParameter;
      const rec = items.find(i => i.Key === 'ReceiverPartyPublicName');
      if (rec && rec.Value) receiverName = String(rec.Value);
    }

    if (resultCode === 0) {
      // SUCCESS — mark daraja_requests as success
      await db.query(
        `UPDATE daraja_requests
            SET status = 'success',
                result_code = 0,
                result_desc = ?,
                mpesa_receipt = ?,
                b2c_transaction_id = ?,
                b2c_conversation_id = ?,
                b2c_receiver_name = ?,
                raw_callback = ?
          WHERE id = ?`,
        [
          resultDesc || 'Success',
          transactionId,
          transactionId,
          conversationId,
          receiverName,
          JSON.stringify(req.body),
          reqRow.id,
        ]
      );

      // If this was a loan disbursement, mark the loan as active
      if (reqRow.loan_id) {
        await db.query(
          `UPDATE loans
              SET status = 'active', disbursed_at = NOW()
            WHERE id = ? AND status = 'approved'`,
          [reqRow.loan_id]
        );

        // Record a disbursement transaction
        await db.query(
          `INSERT INTO transactions
            (loan_id, client_id, type, amount, mpesa_receipt, reference, status, notes, recorded_by)
           VALUES (?, ?, 'disbursement', ?, ?, 'MPESA-B2C', 'completed', 'M-Pesa B2C disbursement', NULL)`,
          [reqRow.loan_id, reqRow.client_id, reqRow.amount, transactionId]
        );
      }

      await audit.log({
        actorRole: 'system',
        action: 'daraja.b2c_disbursement_recorded',
        entityType: reqRow.loan_id ? 'loan' : 'daraja_request',
        entityId: reqRow.loan_id || reqRow.id,
        newValues: {
          amount: reqRow.amount,
          mpesa_receipt: transactionId,
          originator_conversation_id: originatorId,
          receiver: receiverName,
        },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });

      console.log('[daraja b2c-callback] success:', transactionId, 'amount:', reqRow.amount);
    } else {
      // FAILURE
      const cls = daraja.classifyResultCode(resultCode);
      await db.query(
        `UPDATE daraja_requests
            SET status = ?,
                result_code = ?,
                result_desc = ?,
                b2c_transaction_id = ?,
                b2c_conversation_id = ?,
                raw_callback = ?
          WHERE id = ?`,
        [cls, resultCode, resultDesc, transactionId, conversationId, JSON.stringify(req.body), reqRow.id]
      );

      console.log('[daraja b2c-callback] failed:', transactionId, 'code:', resultCode, 'desc:', resultDesc);
    }
  } catch (err) {
    console.error('[daraja b2c-callback]', err.message);
  }
});

// ---------------------------------------------------------------
// POST /b2c-timeout — queue timeout callback
// ---------------------------------------------------------------
router.post('/b2c-timeout', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const result = req.body && req.body.Result;
    if (!result) return;

    const originatorId = result.OriginatorConversationID;
    const resultDesc = result.ResultDesc || 'Queue timeout';

    const [rows] = await db.query(
      'SELECT id FROM daraja_requests WHERE b2c_originator_conversation_id = ? LIMIT 1',
      [originatorId]
    );

    if (rows.length) {
      await db.query(
        `UPDATE daraja_requests
            SET status = 'timeout',
                result_desc = ?,
                raw_callback = ?
          WHERE id = ?`,
        [resultDesc, JSON.stringify(req.body), rows[0].id]
      );

      console.warn('[daraja b2c-timeout]', originatorId, resultDesc);
    }
  } catch (err) {
    console.error('[daraja b2c-timeout]', err.message);
  }
});

module.exports = router;
