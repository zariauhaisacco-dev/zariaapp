/*
 * Zaria — USSD route
 *
 * POST /api/ussd — called by Ping Africa when a client dials the shortcode.
 * PUBLIC — no auth (Ping Africa calls this, not a logged-in client).
 *
 * Request body:
 *   { sessionId, phoneNumber, text, serviceCode }
 *
 * Response:
 *   { response: "CON ..." | "END ..." }
 */

const express = require('express');
const Joi = require('joi');
const ussd = require('../services/ussd');

const router = express.Router();

const schema = Joi.object({
  sessionId: Joi.string().required(),
  phoneNumber: Joi.string().required(),
  text: Joi.string().allow('', null).default(''),
  serviceCode: Joi.string().allow('', null).default(''),
});

router.post('/ussd', async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body, { stripUnknown: true });
    if (error) {
      // Always respond with valid USSD syntax so Ping Africa doesn't hang
      return res.json({ response: 'END Invalid request.' });
    }

    const result = await ussd.handleSession({
      sessionId: value.sessionId,
      phoneNumber: value.phoneNumber,
      text: value.text || '',
      serviceCode: value.serviceCode || '',
    });

    res.json({ response: result.response });
  } catch (err) {
    console.error('[ussd route]', err.message);
    res.json({ response: 'END Service error. Please try again.' });
  }
});

module.exports = router;
