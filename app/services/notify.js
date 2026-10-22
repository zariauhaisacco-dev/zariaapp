/*
 * Zaria — Unified notification dispatcher
 *
 * Single entry point for all client-facing alerts.
 * Routes to WhatsApp → SMS → Email (in priority order) based on
 * client preferences and channel availability.
 *
 * Usage:
 *   await notify.alert({ template: 'account_approved', clientId: 5, data: {...} });
 *   await notify.alert({ template: 'loan_disbursed', clientId: 5, data: {...} });
 *
 * Templates are defined in TEMPLATES below. Each template may have:
 *   - whatsapp: function(data) => string (or null to skip WhatsApp)
 *   - sms:      function(data) => string (or null to skip SMS)
 *   - email:    string (name of email.sendXxx function) or null
 */

const db = require('../db');
const ping = require('./ping');
const email = require('./email');

// ---------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------
// Each function receives `data` (may include firstName derived from client.full_name)
// Email field points to a function name in email.js
// ---------------------------------------------------------------
const TEMPLATES = {
  // ---- Onboarding ----
  account_approved: {
    whatsapp: d => `Welcome to Zaria Uhai SACCO, ${d.fullName || d.firstName}! 🎉

Your account is approved and ready.

Login: https://zariauhai.com

Questions? Call 0746 138 896`,
    sms: d => `ZARIA: Welcome ${d.firstName}! Account approved. Login: zariauhai.com`,
    email: 'sendApproval',
  },
  account_rejected: {
    whatsapp: d => `Hi ${d.firstName},

Unfortunately, we're unable to approve your Zaria application at this time.

If you believe this is a mistake, call us on 0746 138 896.`,
    sms: d => `ZARIA: Your application was not approved. Call 0746 138 896 for details.`,
    email: 'sendRejection',
  },

  // ---- Loan lifecycle ----
  loan_request_received: {
    whatsapp: d => `Hi ${d.firstName},

Your loan request for KES ${d.amount} over ${d.termMonths} months has been received.

We'll review it within 1–2 business days.

Login: https://zariauhai.com`,
    sms: d => `ZARIA: Loan request of KES ${d.amount} for ${d.termMonths} months received. Review in 1-2 days.`,
    email: 'sendLoanRequestReceived',
  },
  loan_request_approved: {
    whatsapp: d => `✅ Loan Approved

Your loan of KES ${d.amount} for ${d.termMonths} months is approved.

Disbursement will be processed shortly.

Login: https://zariauhai.com`,
    sms: d => `ZARIA: Loan of KES ${d.amount} approved. Disbursement in process.`,
    email: 'sendLoanRequestApproved',
  },
  loan_request_rejected: {
    whatsapp: d => `Hi ${d.firstName},

Your loan request for KES ${d.amount} was not approved.${d.reason ? '\n\nReason: ' + d.reason : ''}

Call 0746 138 896 for more information.`,
    sms: d => `ZARIA: Loan request of KES ${d.amount} not approved.${d.reason ? ' Reason: ' + d.reason.substring(0, 60) : ''} Call 0746 138 896.`,
    email: 'sendLoanRequestRejected',
  },
  loan_disbursed: {
    whatsapp: d => `✅ Money Sent!

KES ${d.amount} disbursed to your M-Pesa${d.mpesaReceipt ? '\nReceipt: ' + d.mpesaReceipt : ''}

Repayable: KES ${d.totalRepayable || d.amount} over ${d.termMonths || '-'} months.

Login: https://zariauhai.com`,
    sms: d => `ZARIA: KES ${d.amount} disbursed to M-Pesa.${d.mpesaReceipt ? ' Receipt ' + d.mpesaReceipt + '.' : ''} Repay KES ${d.totalRepayable || d.amount}.`,
    email: 'sendLoanDisbursed',
  },

  // ---- Payments ----
  payment_received: {
    whatsapp: d => `✅ Payment Received

KES ${d.amount} received.${d.mpesaReceipt ? '\nReceipt: ' + d.mpesaReceipt : ''}

${d.outstanding != null ? 'Outstanding: KES ' + d.outstanding + '\n' : ''}${d.fullyRepaid ? '\n🎉 Loan fully repaid! Thank you.' : ''}

Thank you!

Login: https://zariauhai.com`,
    sms: d => `ZARIA: Payment of KES ${d.amount} received.${d.mpesaReceipt ? ' Receipt ' + d.mpesaReceipt + '.' : ''}${d.outstanding != null ? ' Outstanding: KES ' + d.outstanding + '.' : ''}${d.fullyRepaid ? ' Loan repaid! Thanks.' : ''}`,
    email: 'sendPaymentReceived',
  },

  // ---- Reminders ----
  payment_reminder: {
    whatsapp: d => `Hi ${d.firstName},

A payment of KES ${d.amountDue} is due ${d.daysUntil === 0 ? 'today' : d.daysUntil === 1 ? 'tomorrow' : 'in ' + d.daysUntil + ' days'} (${d.dueDate}).

Outstanding: KES ${d.outstanding}

Pay via M-Pesa: https://zariauhai.com`,
    sms: d => `ZARIA: Loan payment of KES ${d.amountDue} due ${d.daysUntil === 0 ? 'today' : 'in ' + d.daysUntil + ' day' + (d.daysUntil === 1 ? '' : 's')}. Pay: zariauhai.com`,
    email: 'sendPaymentReminder',
  },
  overdue_notice: {
    whatsapp: d => `⚠️ Overdue Notice

Your loan payment of KES ${d.amountDue} is ${d.daysOverdue} day${d.daysOverdue === 1 ? '' : 's'} overdue.

Please pay immediately to avoid penalties.

Login: https://zariauhai.com`,
    sms: d => `ZARIA: Payment of KES ${d.amountDue} overdue ${d.daysOverdue} day${d.daysOverdue === 1 ? '' : 's'}. Pay now: zariauhai.com`,
    email: 'sendOverdueNotice',
  },

  // ---- Chama ----
  chama_invite: {
    whatsapp: d => `You've been invited to join ${d.chamaName} on Zaria! 🏘

${d.inviterName ? 'Invited by: ' + d.inviterName + '\n\n' : ''}Check your email for the invite link, or visit:
https://zariauhai.com/client/chama/invite?token=${d.token || ''}`,
    sms: d => `ZARIA: You've been invited to join ${d.chamaName}. Check your email or call 0746 138 896.`,
    email: 'sendChamaInvite',
  },

  // ---- Password / auth ----
  password_reset: {
    whatsapp: d => `Your Zaria password reset link:

${d.resetUrl}

Expires in 1 hour. If you didn't request this, ignore.`,
    sms: d => `ZARIA: Password reset: ${d.resetUrl} (valid 1 hour)`,
    email: null,  // handled by auth.js separately (has its own template)
  },
  // ---- M-Pesa payment events (auto-triggered from daraja-reconcile) ----
  savings_deposit_received: {
    whatsapp: d => `✅ Deposit received\n\nKES ${d.amount} added to your savings.\n${d.receipt ? 'Receipt: ' + d.receipt + '\n' : ''}New balance: KES ${d.newBalance}\n\nLogin: https://zariauhai.com`,
    sms: d => `ZARIA: KES ${d.amount} deposited to savings. Balance: KES ${d.newBalance}.${d.receipt ? ' Rcpt ' + d.receipt + '.' : ''}`,
    email: 'sendPaymentReceived',
  },
  chama_contribution_received: {
    whatsapp: d => `✅ Chama contribution received\n\nKES ${d.amount} to ${d.chamaName || 'your chama'}\n${d.receipt ? 'Receipt: ' + d.receipt + '\n' : ''}Status: ${d.status || 'paid'}\n\nLogin: https://zariauhai.com`,
    sms: d => `ZARIA: KES ${d.amount} received for ${d.chamaName || 'chama'}. Status: ${d.status || 'paid'}.${d.receipt ? ' Rcpt ' + d.receipt + '.' : ''}`,
    email: null,
  },
  chama_payout_received: {
    whatsapp: d => `🎉 Times money payout!\n\nYou've received KES ${d.amount} from ${d.chamaName || 'your chama'}.\n${d.mpesaReceipt ? 'Receipt: ' + d.mpesaReceipt + '\n' : ''}\nLogin: https://zariauhai.com`,
    sms: d => `ZARIA: Payout of KES ${d.amount} received from ${d.chamaName || 'chama'}.${d.mpesaReceipt ? ' Rcpt ' + d.mpesaReceipt + '.' : ''}`,
    email: null,
  },
  registration_fee_paid: {
    whatsapp: d => `✅ Registration complete\n\nKES ${d.amount} registration fee confirmed.\nYou now have full access to Zaria!\n\nLogin: https://zariauhai.com`,
    sms: d => `ZARIA: Registration fee of KES ${d.amount} received. Account fully active!`,
    email: null,
  },
  registration_fee_due: {
    whatsapp: d => `Welcome to Zaria Uhai SACCO! 🎉\n\nYour account is approved. To activate:\nPay registration fee of KES ${d.amount} via M-Pesa from your dashboard.\n\nhttps://zariauhai.com`,
    sms: d => `ZARIA: Welcome! Pay KES ${d.amount} registration fee to activate: zariauhai.com`,
    email: null,
  },

};

// ---------------------------------------------------------------
// Email data normalizer — camelCase → snake_case
// (so notify callers use one data shape; email.sendXxx still works)
// ---------------------------------------------------------------
function normalizeEmailData(data) {
  const n = Object.assign({}, data);
  if (data.clientName && !data.client_name) n.client_name = data.clientName;
  if (data.fullName && !data.full_name) n.full_name = data.fullName;
  if (data.termMonths && !data.term_months) n.term_months = data.termMonths;
  if (data.mpesaReceipt && !data.mpesa_receipt) n.mpesa_receipt = data.mpesaReceipt;
  if (data.loanId != null && data.loan_id == null) n.loan_id = data.loanId;
  if (data.totalRepayable && !data.total_repayable) n.total_repayable = data.totalRepayable;
  if (data.amountDue && !data.amount_due) n.amount_due = data.amountDue;
  if (data.dueDate && !data.due_date) n.due_date = data.dueDate;
  if (data.daysUntil != null && data.days_until == null) n.days_until = data.daysUntil;
  if (data.daysOverdue != null && data.days_overdue == null) n.days_overdue = data.daysOverdue;
  if (data.fullyRepaid != null && data.fully_repaid == null) n.fully_repaid = data.fullyRepaid;
  if (data.interestRate && !data.interest_rate) n.interest_rate = data.interestRate;
  return n;
}

// ---------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------
async function alert({ template, clientId, data, forceChannels }) {
  const t = TEMPLATES[template];
  if (!t) {
    console.warn('[notify] Unknown template:', template);
    return { sent: [], failed: [{ channel: 'none', reason: 'unknown_template' }], skipped: [] };
  }

  let client = null;
  if (clientId) {
    try {
      const [rows] = await db.query(
        'SELECT c.id, c.full_name, c.phone, c.sms_opt_out, c.whatsapp_opt_in, u.email FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ? LIMIT 1',
        [clientId]
      );
      if (rows.length) client = rows[0];
    } catch (err) {
      console.error('[notify] client lookup failed:', err.message);
    }
  }

  const firstName = client && client.full_name
    ? client.full_name.trim().split(/\s+/)[0]
    : (data && data.firstName) || 'member';
  const fullData = Object.assign({}, data, { firstName });

  const results = { sent: [], failed: [], skipped: [] };
  const channelsToUse = forceChannels || ['whatsapp', 'sms', 'email'];

  for (const ch of channelsToUse) {
    // WhatsApp
    if (ch === 'whatsapp') {
      if (!t.whatsapp) { results.skipped.push('whatsapp'); continue; }
      if (!client) { results.skipped.push('whatsapp'); continue; }
      if (!client.whatsapp_opt_in) { results.skipped.push('whatsapp_optout'); continue; }
      if (!client.phone) { results.skipped.push('whatsapp_nophone'); continue; }
      try {
        const msg = t.whatsapp(fullData);
        const r = await ping.sendWhatsAppText({ to: client.phone, text: msg, template, clientId: client.id });
        if (r.ok) results.sent.push('whatsapp');
        else results.failed.push({ channel: 'whatsapp', reason: r.error || r.reason });
      } catch (err) {
        results.failed.push({ channel: 'whatsapp', reason: err.message });
      }
      continue;
    }

    // SMS
    if (ch === 'sms') {
      if (!t.sms) { results.skipped.push('sms'); continue; }
      if (!client) { results.skipped.push('sms'); continue; }
      if (client.sms_opt_out) { results.skipped.push('sms_optout'); continue; }
      if (!client.phone) { results.skipped.push('sms_nophone'); continue; }
      try {
        const msg = t.sms(fullData);
        const r = await ping.sendSms({ to: client.phone, message: msg, template, clientId: client.id });
        if (r.ok) results.sent.push('sms');
        else results.failed.push({ channel: 'sms', reason: r.error || r.reason });
      } catch (err) {
        results.failed.push({ channel: 'sms', reason: err.message });
      }
      continue;
    }

    // Email
    if (ch === 'email') {
      if (!t.email) { results.skipped.push('email'); continue; }
      if (!client && !data.email) { results.skipped.push('email_noemail'); continue; }
      try {
        const fn = email[t.email];
        if (typeof fn !== 'function') {
          results.failed.push({ channel: 'email', reason: 'template_not_found' });
          continue;
        }
        // Email function signature varies — pass through as best we can
        const recipient = (client && client.email) || data.email;
        await fn(recipient, normalizeEmailData(data));
        results.sent.push('email');
      } catch (err) {
        results.failed.push({ channel: 'email', reason: err.message });
      }
      continue;
    }
  }

  return results;
}

module.exports = {
  alert,
  TEMPLATES,
};
