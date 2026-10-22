const nodemailer = require('nodemailer');

// Single shared transporter. cPanel SMTP on port 587 (STARTTLS).
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: false, // STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false }, // Truehost cert chain workaround
  pool: true,
  maxConnections: 3,
  maxMessages: 50,
  connectionTimeout: 10000,
  greetingTimeout: 8000,
  socketTimeout: 15000,
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Minimal, honest email wrapper. No marketing chrome.
function wrap(title, bodyHtml) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#F8F7F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0A0F1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F7F5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #E5E2DD;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:22px 26px;border-bottom:1px solid #E5E2DD;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:30px;height:30px;background:#F5B301;border-radius:8px;text-align:center;vertical-align:middle;font-weight:800;color:#0B1F3A;font-size:16px;line-height:30px;">Z</td>
            <td style="padding-left:10px;font-weight:700;font-size:15px;color:#0A0F1A;">Zaria</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:26px;">${bodyHtml}</td></tr>
        <tr><td style="padding:18px 26px;background:#F8F7F5;border-top:1px solid #E5E2DD;font-size:12px;color:#6B7484;line-height:1.5;">
          Zaria Lending · Nairobi, Kenya<br>
          Questions? <a href="mailto:info@zariauhai.com" style="color:#12294B;">info@zariauhai.com</a> · 0746 138 896
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(href, label) {
  return `<a href="${href}" style="display:inline-block;padding:12px 22px;background:#0B1F3A;color:#F8F7F5;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>`;
}

async function send({ to, subject, html, text, replyTo }) {
  const from = process.env.SMTP_FROM || '"Zaria" <' + process.env.SMTP_USER + '>';
  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      replyTo: replyTo || undefined,
    });
    return info;
  } catch (err) {
    throw err;
  }
}


// ---- Specific email templates ----

async function sendSignupReceived(to, fullName) {
  const html = wrap('Application received', `
    <h1 style="margin:0 0 10px;font-size:20px;">We received your application</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Hi ${escapeHtml(fullName)},</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      Thank you for applying to Zaria. Our team is reviewing your details and you'll hear from us
      within <strong>1–2 business days</strong>.
    </p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      If you have any questions in the meantime, reply to this email or call
      <strong>0746 138 896</strong>.
    </p>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
  `);
  return send({
    to,
    subject: 'We received your Zaria application',
    html,
  });
}

async function sendAdminNewSignup(adminEmail, applicant) {
  const baseUrl = process.env.APP_URL || 'https://zariauhai.com';
  const html = wrap('New signup', `
    <h1 style="margin:0 0 10px;font-size:20px;">New pending registration</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Someone applied to Zaria. Review and approve or reject.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;border:1px solid #E5E2DD;border-radius:8px;width:100%;font-size:13px;">
      <tr><td style="padding:8px 12px;color:#6B7484;width:120px;">Name</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(applicant.full_name)}</td></tr>
      <tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Email</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;">${escapeHtml(applicant.email)}</td></tr>
      <tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Phone</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;">${escapeHtml(applicant.phone)}</td></tr>
      <tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">National ID</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;">${escapeHtml(applicant.national_id)}</td></tr>
    </table>
    ${button(`${baseUrl}/admin/registrations`, 'Review in admin')}
  `);
  return send({
    to: adminEmail,
    subject: `New Zaria signup — ${applicant.full_name}`,
    html,
  });
}

async function sendApproval(applicant) {
  const baseUrl = process.env.APP_URL || 'https://zariauhai.com';
  const html = wrap('Account ready', `
    <h1 style="margin:0 0 10px;font-size:20px;">Your account is ready</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Hi ${escapeHtml(applicant.full_name)},</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      Your Zaria application has been approved. You can sign in with the email and password
      you chose when you applied.
    </p>
    <p style="margin:22px 0;">${button(`${baseUrl}/`, 'Sign in to Zaria')}</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      From your dashboard, you can request a loan, view your repayment schedule, and repay via M-Pesa.
    </p>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
  `);
  return send({
    to: applicant.email,
    subject: 'Welcome to Zaria — your account is approved',
    html,
  });
}

async function sendRejection(applicant, reason) {
  const html = wrap('Application update', `
    <h1 style="margin:0 0 10px;font-size:20px;">About your Zaria application</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Hi ${escapeHtml(applicant.full_name)},</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      Thank you for your interest. Unfortunately, we're unable to approve your application at this time.
    </p>
    ${reason ? `<div style="margin:14px 0;padding:12px 14px;background:#FBF2DE;border-left:3px solid #A76A00;border-radius:4px;font-size:14px;color:#2A3342;">
      <strong style="display:block;margin-bottom:4px;">Reason:</strong>${escapeHtml(reason)}
    </div>` : ''}
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      If you believe this was a mistake, or your details have changed, you're welcome to
      call us on <strong>0746 138 896</strong> or reapply.
    </p>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
  `);
  return send({
    to: applicant.email,
    subject: 'Update on your Zaria application',
    html,
  });
}


// ---- Loan-related templates ----

async function sendAdminNewLoanRequest(adminEmail, { client_name, client_phone, amount, term_months, product_name, purpose, request_id }) {
  const baseUrl = process.env.APP_URL || 'https://zariauhai.com';
  const html = wrap('New loan request', `
    <h1 style="margin:0 0 10px;font-size:20px;">New loan request</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      <strong>${escapeHtml(client_name)}</strong> has requested a loan. Review it in the admin panel.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;border:1px solid #E5E2DD;border-radius:8px;width:100%;font-size:13px;">
      <tr><td style="padding:8px 12px;color:#6B7484;width:120px;">Client</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(client_name)}</td></tr>
      <tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Phone</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;">${escapeHtml(client_phone)}</td></tr>
      <tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Amount</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;font-weight:600;">KES ${Number(amount).toLocaleString()}</td></tr>
      <tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Term</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;">${term_months} month${term_months === 1 ? '' : 's'}</td></tr>
      ${product_name ? '<tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Product</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;">' + escapeHtml(product_name) + '</td></tr>' : ''}
      ${purpose ? '<tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Purpose</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;">' + escapeHtml(purpose) + '</td></tr>' : ''}
    </table>
    ${button(baseUrl + '/admin/requests', 'Review in admin')}
  `);
  return send({
    to: adminEmail,
    subject: 'New loan request — ' + escapeHtml(client_name),
    html,
  });
}

async function sendLoanRequestReceived(to, { client_name, amount, term_months }) {
  const html = wrap('Request received', `
    <h1 style="margin:0 0 10px;font-size:20px;">We received your loan request</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Hi ${escapeHtml(client_name)},</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      We received your request for <strong>KES ${Number(amount).toLocaleString()}</strong>
      over ${term_months} month${term_months === 1 ? '' : 's'}.
      Our team is reviewing it and you'll hear from us within 1–2 business days.
    </p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      If you have any questions, reply to this email or call <strong>0746 138 896</strong>.
    </p>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
  `);
  return send({
    to,
    subject: 'We received your Zaria loan request',
    html,
  });
}

async function sendLoanRequestApproved(to, { client_name, amount, term_months, loan_id, interest_rate }) {
  const baseUrl = process.env.APP_URL || 'https://zariauhai.com';
  const interestPct = (Number(interest_rate) * 100).toFixed(1);
  const total = Number(amount) * (1 + Number(interest_rate));
  const html = wrap('Request approved', `
    <h1 style="margin:0 0 10px;font-size:20px;">Your request is approved</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Hi ${escapeHtml(client_name)},</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      Good news — your loan request has been approved. We're now preparing disbursement to your M-Pesa.
      Here are the terms:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;border:1px solid #E5E2DD;border-radius:8px;width:100%;font-size:13px;">
      <tr><td style="padding:8px 12px;color:#6B7484;width:160px;">Loan</td><td style="padding:8px 12px;font-weight:600;">#${loan_id}</td></tr>
      <tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Principal</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;font-weight:600;">KES ${Number(amount).toLocaleString()}</td></tr>
      <tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Interest</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;">${interestPct}% flat</td></tr>
      <tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Term</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;">${term_months} month${term_months === 1 ? '' : 's'}</td></tr>
      <tr><td style="padding:8px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Total repayable</td><td style="padding:8px 12px;border-top:1px solid #E5E2DD;font-weight:600;">KES ${Number(total).toLocaleString()}</td></tr>
    </table>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      You'll receive a separate confirmation as soon as the funds are sent. No action is needed from you right now.
    </p>
    <p style="margin:22px 0;">${button(baseUrl + '/client/loans/' + loan_id, 'View your loan')}</p>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
  `);
  return send({
    to,
    subject: 'Your Zaria loan is approved — Loan #' + loan_id,
    html,
  });
}

async function sendLoanRequestRejected(to, { client_name, reason, amount }) {
  const html = wrap('Request update', `
    <h1 style="margin:0 0 10px;font-size:20px;">About your loan request</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Hi ${escapeHtml(client_name)},</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      Thank you for your interest. Unfortunately, we're unable to approve your request for
      <strong>KES ${Number(amount).toLocaleString()}</strong> at this time.
    </p>
    ${reason ? '<div style="margin:14px 0;padding:12px 14px;background:#FBF2DE;border-left:3px solid #A76A00;border-radius:4px;font-size:14px;color:#2A3342;"><strong style="display:block;margin-bottom:4px;">Reason:</strong>' + escapeHtml(reason) + '</div>' : ''}
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      If your circumstances change, you're welcome to apply again. If you have questions, call us on
      <strong>0746 138 896</strong>.
    </p>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
  `);
  return send({
    to,
    subject: 'Update on your Zaria loan request',
    html,
  });
}

async function sendLoanDisbursed(to, { client_name, amount, loan_id, mpesa_receipt }) {
  const baseUrl = process.env.APP_URL || 'https://zariauhai.com';
  const html = wrap('Loan disbursed', `
    <h1 style="margin:0 0 10px;font-size:20px;">Funds sent to your M-Pesa</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Hi ${escapeHtml(client_name)},</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      <strong>KES ${Number(amount).toLocaleString()}</strong> has been sent to the M-Pesa number on your account.
    </p>
    ${mpesa_receipt ? '<p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">M-Pesa receipt: <strong>' + escapeHtml(mpesa_receipt) + '</strong></p>' : ''}
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      Your repayment schedule is now live. You can view it any time from your dashboard.
    </p>
    <p style="margin:22px 0;">${button(baseUrl + '/client/loans/' + loan_id, 'View your loan')}</p>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
  `);
  return send({
    to,
    subject: 'Funds sent — Loan #' + loan_id + ' disbursed',
    html,
  });
}

async function sendPaymentReceived(to, { client_name, amount, outstanding, loan_id, mpesa_receipt, fully_repaid }) {
  const baseUrl = process.env.APP_URL || 'https://zariauhai.com';
  const html = wrap('Payment received', `
    <h1 style="margin:0 0 10px;font-size:20px;">${fully_repaid ? 'Loan fully repaid 🎉' : 'Payment received'}</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Hi ${escapeHtml(client_name)},</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      We've recorded your payment of <strong>KES ${Number(amount).toLocaleString()}</strong>.
    </p>
    ${mpesa_receipt ? '<p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">M-Pesa receipt: <strong>' + escapeHtml(mpesa_receipt) + '</strong></p>' : ''}
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      ${fully_repaid
        ? 'Your loan is now fully repaid. Thank you for your business. You\'re welcome to apply again any time.'
        : 'Remaining balance: <strong>KES ' + Number(outstanding).toLocaleString() + '</strong>.'}
    </p>
    <p style="margin:22px 0;">${button(baseUrl + '/client/loans/' + loan_id, 'View your loan')}</p>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
  `);
  return send({
    to,
    subject: fully_repaid ? 'Your Zaria loan is fully repaid' : 'Payment received — Loan #' + loan_id,
    html,
  });
}

// ---- Reminder & escalation templates ----

async function sendPaymentReminder(to, { client_name, amount_due, due_date, days_until, loan_id, outstanding }) {
  const baseUrl = process.env.APP_URL || 'https://zariauhai.com';
  const when = days_until === 0 ? 'today' : (days_until === 1 ? 'tomorrow' : 'in ' + days_until + ' days');
  const urgency = days_until === 0 ? 'var(--neg)' : '#A76A00';
  const html = wrap('Payment reminder', `
    <h1 style="margin:0 0 10px;font-size:20px;">Payment reminder</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Hi ${escapeHtml(client_name)},</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      This is a friendly reminder that your loan payment of
      <strong>KES ${Number(amount_due).toLocaleString()}</strong> is due ${when}
      (${new Date(due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}).
    </p>
    <div style="margin:14px 0;padding:14px 16px;background:#FBF2DE;border-left:3px solid ${urgency};border-radius:4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;">
        <tr><td style="color:#6B7484;padding:3px 0;">Amount due</td><td style="text-align:right;font-weight:600;font-family:monospace;">KES ${Number(amount_due).toLocaleString()}</td></tr>
        <tr><td style="color:#6B7484;padding:3px 0;">Due date</td><td style="text-align:right;font-weight:600;">${new Date(due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td></tr>
        <tr><td style="color:#6B7484;padding:3px 0;">Current outstanding</td><td style="text-align:right;font-family:monospace;">KES ${Number(outstanding).toLocaleString()}</td></tr>
      </table>
    </div>
    <p style="margin:22px 0;">${button(baseUrl + '/client/loans/' + loan_id, 'View your loan')}</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      Pay via M-Pesa to the number on file, or contact us on <strong>0746 138 896</strong>.
    </p>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
  `);
  return send({
    to,
    subject: 'Payment of KES ' + Number(amount_due).toLocaleString() + ' ' +
      (days_until === 0 ? 'due today' : (days_until === 1 ? 'due tomorrow' : 'due in ' + days_until + ' days')),
    html,
  });
}

async function sendOverdueNotice(to, { client_name, amount_due, days_overdue, loan_id, outstanding, stage }) {
  const baseUrl = process.env.APP_URL || 'https://zariauhai.com';
  const severity = days_overdue >= 30 ? 'urgent' : (days_overdue >= 14 ? 'high' : 'moderate');
  const severityText = {
    moderate: 'Your payment is past due',
    high: 'Please act on this overdue payment',
    urgent: 'Urgent — your loan is significantly overdue',
  }[severity];

  const html = wrap('Overdue notice', `
    <h1 style="margin:0 0 10px;font-size:20px;">${severityText}</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Hi ${escapeHtml(client_name)},</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      Your loan payment of <strong>KES ${Number(amount_due).toLocaleString()}</strong>
      is <strong>${days_overdue} day${days_overdue === 1 ? '' : 's'} overdue</strong>.
    </p>
    <div style="margin:14px 0;padding:14px 16px;background:#FDECEA;border-left:3px solid #B23A2F;border-radius:4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;">
        <tr><td style="color:#6B7484;padding:3px 0;">Amount due</td><td style="text-align:right;font-weight:600;font-family:monospace;">KES ${Number(amount_due).toLocaleString()}</td></tr>
        <tr><td style="color:#6B7484;padding:3px 0;">Days overdue</td><td style="text-align:right;font-weight:600;">${days_overdue}</td></tr>
        <tr><td style="color:#6B7484;padding:3px 0;">Current outstanding</td><td style="text-align:right;font-family:monospace;">KES ${Number(outstanding).toLocaleString()}</td></tr>
      </table>
    </div>
    ${days_overdue >= 14 ? '<p style="margin:0 0 14px;line-height:1.55;color:#2A3342;"><strong>Please note:</strong> If payment is not received soon, we may be required to escalate this matter formally. Contact us to arrange a payment plan.</p>' : ''}
    <p style="margin:22px 0;">${button(baseUrl + '/client/loans/' + loan_id, 'View and pay now')}</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      Call us on <strong>0746 138 896</strong> if you're having trouble paying. We can often work out a plan.
    </p>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
  `);
  return send({
    to,
    subject: 'Overdue: KES ' + Number(amount_due).toLocaleString() + ' — ' + days_overdue + ' day' + (days_overdue === 1 ? '' : 's') + ' late',
    html,
  });
}

async function sendAdminMonthlySummary(adminEmail, stats) {
  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const html = wrap('Monthly summary', `
    <h1 style="margin:0 0 10px;font-size:20px;">${monthName} summary</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      Here's how Zaria performed last month.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;border:1px solid #E5E2DD;border-radius:8px;width:100%;font-size:13px;">
      <tr><td style="padding:10px 12px;color:#6B7484;">New loans disbursed</td><td style="padding:10px 12px;text-align:right;font-weight:600;">${stats.new_loans}</td></tr>
      <tr><td style="padding:10px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Total amount disbursed</td><td style="padding:10px 12px;text-align:right;font-weight:600;font-family:monospace;border-top:1px solid #E5E2DD;">KES ${Number(stats.amount_disbursed).toLocaleString()}</td></tr>
      <tr><td style="padding:10px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Payments collected</td><td style="padding:10px 12px;text-align:right;font-weight:600;font-family:monospace;border-top:1px solid #E5E2DD;">KES ${Number(stats.amount_collected).toLocaleString()}</td></tr>
      <tr><td style="padding:10px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Loans fully repaid</td><td style="padding:10px 12px;text-align:right;font-weight:600;border-top:1px solid #E5E2DD;">${stats.loans_repaid}</td></tr>
      <tr><td style="padding:10px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">Loans overdue</td><td style="padding:10px 12px;text-align:right;font-weight:600;border-top:1px solid #E5E2DD;color:${stats.loans_overdue > 0 ? '#B23A2F' : '#1B7F4B'};">${stats.loans_overdue}</td></tr>
      <tr><td style="padding:10px 12px;color:#6B7484;border-top:1px solid #E5E2DD;">New clients approved</td><td style="padding:10px 12px;text-align:right;font-weight:600;border-top:1px solid #E5E2DD;">${stats.new_clients}</td></tr>
    </table>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— Zaria automated report</p>
  `);
  return send({
    to: adminEmail,
    subject: 'Zaria monthly summary — ' + monthName,
    html,
  });
}

async function sendBroadcast(to, { subject, body }) {
  const html = wrap(subject, `
    <h1 style="margin:0 0 14px;font-size:20px;">${escapeHtml(subject)}</h1>
    <div style="margin:0 0 14px;line-height:1.6;color:#2A3342;white-space:pre-wrap;">${escapeHtml(body)}</div>
    <p style="margin:22px 0 0;color:#6B7484;font-size:12px;">
      You're receiving this because you're a member of Zaria Uhai SACCO.
    </p>
  `);
  return send({ to, subject, html });
}

// Chama invite — sent from admin when they invite a client or email
async function sendChamaInvite({ to, fullName, chamaName, chamaCode, inviterName, acceptUrl, declineUrl, expiresInDays }) {
  const days = expiresInDays || 7;
  const html = wrap('You have been invited to a chama', `
    <h1 style="margin:0 0 10px;font-size:20px;">You have been invited to join ${escapeHtml(chamaName)}</h1>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">Hi ${escapeHtml(fullName || 'there')},</p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      ${escapeHtml(inviterName || 'Your chama admin')} has invited you to join
      <strong>${escapeHtml(chamaName)}</strong> (<code style="background:#F4F1EC;padding:1px 5px;border-radius:3px;font-size:12px;">${escapeHtml(chamaCode)}</code>)
      on Zaria.
    </p>
    <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
      A chama is a savings group. Members contribute regularly, save together, and (if enabled) participate in a
      merry-go-round. Joining gives you:
    </p>
    <ul style="margin:0 0 14px;padding-left:20px;line-height:1.7;color:#2A3342;">
      <li>A shared savings pot with your group</li>
      <li>Track your monthly contributions</li>
      <li>M-Pesa STK push for easy payments</li>
      <li>Visibility into your group's progress</li>
    </ul>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
      <tr>
        <td style="padding-right:10px;">${button(acceptUrl, 'Accept invite')}</td>
        <td><a href="${declineUrl}" style="display:inline-block;padding:10px 18px;background:#F4F1EC;color:#2A3342;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Decline</a></td>
      </tr>
    </table>
    <p style="margin:0 0 14px;line-height:1.55;color:#6B7484;font-size:13px;">
      This invite expires in <strong>${days} days</strong>. If you don't recognize this chama,
      you can safely decline — no changes will be made to your account.
    </p>
    <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
  `);
  return send({
    to,
    subject: `You have been invited to join ${chamaName}`,
    html,
  });
}

module.exports = {
  send,
  sendChamaInvite,
  wrap,
  button,
  sendSignupReceived,
  sendAdminNewSignup,
  sendApproval,
  sendRejection,
  sendAdminNewLoanRequest,
  sendLoanRequestReceived,
  sendLoanRequestApproved,
  sendLoanRequestRejected,
  sendLoanDisbursed,
  sendPaymentReceived,
  sendPaymentReminder,
  sendOverdueNotice,
  sendAdminMonthlySummary,
  sendBroadcast,
};
