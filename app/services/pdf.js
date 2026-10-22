/*
 * Zaria — PDF document generation
 */

const PDFDocument = require('pdfkit');

const COLORS = {
  navy: '#0B1F3A',
  navyMid: '#1E3A66',
  amber: '#F5B301',
  ink: '#0A0F1A',
  ink700: '#2A3342',
  ink500: '#6B7484',
  line: '#E5E2DD',
  paper: '#FFFFFF',
  paperAlt: '#F8F7F5',
  pos: '#1B7F4B',
  neg: '#B23A2F',
};

const FONT_REG = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_MONO = 'Courier';

function fmtMoney(n) {
  n = Number(n) || 0;
  return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function drawHeader(doc, docTitle) {
  const pageW = doc.page.width;
  const margin = 50;

  doc.rect(0, 0, pageW, 90).fill(COLORS.navy);

  doc.fillColor(COLORS.amber).roundedRect(margin, 28, 34, 34, 8).fill();
  doc.fillColor(COLORS.navy).font(FONT_BOLD).fontSize(20).text('Z', margin, 38, {
    width: 34, align: 'center',
  });

  doc.fillColor(COLORS.paper).font(FONT_BOLD).fontSize(14).text('Zaria', margin + 48, 34);
  doc.font(FONT_REG).fontSize(9).fillColor('#B8C0CC').text('Fast, transparent loans', margin + 48, 50);

  doc.fillColor(COLORS.paper).font(FONT_BOLD).fontSize(16).text(docTitle, pageW - margin - 250, 38, {
    width: 250, align: 'right',
  });

  doc.fillColor(COLORS.ink);
}

function drawFooter(doc, page) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 50;

  doc.strokeColor(COLORS.line).lineWidth(0.5)
    .moveTo(margin, pageH - 60).lineTo(pageW - margin, pageH - 60).stroke();

  doc.font(FONT_REG).fontSize(8).fillColor(COLORS.ink500);
  doc.text('Zaria Lending · Nairobi, Kenya · info@zariauhai.com · 0746 138 896',
    margin, pageH - 48, { width: pageW - margin * 2 - 60 });
  doc.text('Page ' + page, pageW - margin - 50, pageH - 48, { width: 50, align: 'right' });

  doc.fillColor(COLORS.ink);
}

function kvTable(doc, rows, opts) {
  opts = opts || {};
  const startY = doc.y;
  const x = opts.x || 50;
  const w = opts.w || (doc.page.width - 100);
  const lineH = 20;
  const pad = 8;

  rows.forEach(function (r, i) {
    const y = startY + i * lineH;
    if (i % 2 === 0) {
      doc.rect(x, y, w, lineH).fill(COLORS.paperAlt);
    }
    doc.font(FONT_REG).fontSize(9).fillColor(COLORS.ink500)
      .text(r[0], x + pad, y + 6, { width: w * 0.5 - pad });
    doc.font(r.mono !== false ? FONT_MONO : FONT_BOLD).fontSize(10).fillColor(COLORS.ink)
      .text(r[1], x + w * 0.5, y + 5, { width: w * 0.5 - pad, align: 'right' });
  });

  doc.y = startY + rows.length * lineH + 8;
}

function streamReceipt(res, data) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  doc.pipe(res);
  doc.font(FONT_REG);

  drawHeader(doc, 'Payment Receipt');
  doc.y = 120;

  doc.roundedRect(50, doc.y, doc.page.width - 100, 90, 8).fillAndStroke(COLORS.paperAlt, COLORS.line);
  const boxY = doc.y;
  doc.fillColor(COLORS.pos).font(FONT_BOLD).fontSize(11).text('PAYMENT RECEIVED', 70, boxY + 16);
  doc.fillColor(COLORS.ink).font(FONT_MONO).fontSize(28)
    .text('KES ' + fmtMoney(data.amount), 70, boxY + 34);
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(9)
    .text('Recorded ' + fmtDateTime(data.created_at), 70, boxY + 66);
  doc.y = boxY + 110;

  kvTable(doc, [
    ['Receipt number', data.receipt_number || ('R-' + data.transaction_id)],
    ['Loan', '#' + data.loan_id],
    ['Client', data.client_name],
    ['Phone', data.client_phone],
  ]);

  doc.moveDown(0.5);
  doc.fillColor(COLORS.navyMid).font(FONT_BOLD).fontSize(11).text('Payment breakdown');
  doc.moveDown(0.3);

  kvTable(doc, [
    ['Amount paid', 'KES ' + fmtMoney(data.amount)],
    ['M-Pesa receipt', data.mpesa_receipt || '—'],
    ['Reference', data.reference || '—'],
    ['Recorded by', data.recorded_by_name || 'Zaria Admin'],
  ]);

  doc.moveDown(0.5);
  doc.fillColor(COLORS.navyMid).font(FONT_BOLD).fontSize(11).text('Loan status after payment');
  doc.moveDown(0.3);

  kvTable(doc, [
    ['Loan total repayable', 'KES ' + fmtMoney(data.total_repayable)],
    ['Total repaid to date', 'KES ' + fmtMoney(data.amount_repaid)],
    ['Outstanding balance', 'KES ' + fmtMoney(data.outstanding)],
    ['Loan status', (data.loan_status || '').charAt(0).toUpperCase() + (data.loan_status || '').slice(1)],
  ]);

  doc.moveDown(1);
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(9)
    .text('This receipt is computer-generated and valid without signature.',
      50, doc.y, { width: doc.page.width - 100 });

  drawFooter(doc, 1);
  doc.end();
}

function streamStatement(res, data) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  doc.pipe(res);
  doc.font(FONT_REG);

  drawHeader(doc, 'Account Statement');
  doc.y = 120;

  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(14).text(data.client.full_name);
  doc.font(FONT_REG).fontSize(10).fillColor(COLORS.ink500)
    .text(data.client.phone + ' · ' + (data.client.email || ''), 50, doc.y);
  doc.moveDown(0.3);
  doc.text('Statement period: ' + fmtDate(data.period_from) + ' to ' + fmtDate(data.period_to), 50, doc.y);

  doc.moveDown(1.5);

  const startY = doc.y;
  const w = (doc.page.width - 100) / 3;
  const items = [
    ['Total borrowed', 'KES ' + fmtMoney(data.totals.borrowed)],
    ['Total repaid', 'KES ' + fmtMoney(data.totals.repaid)],
    ['Current outstanding', 'KES ' + fmtMoney(data.totals.outstanding)],
  ];
  items.forEach(function (it, i) {
    const x = 50 + i * w;
    doc.rect(x, startY, w - 4, 60).fill(COLORS.paperAlt);
    doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(8).text(it[0].toUpperCase(), x + 10, startY + 10);
    doc.fillColor(COLORS.ink).font(FONT_MONO).fontSize(13).text(it[1], x + 10, startY + 28);
  });
  doc.y = startY + 80;

  doc.fillColor(COLORS.navyMid).font(FONT_BOLD).fontSize(12).text('Loans');
  doc.moveDown(0.5);

  data.loans.forEach(function (l) {
    doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(10)
      .text('Loan #' + l.id + ' · ' + fmtDate(l.disbursed_at || l.created_at), 50, doc.y);
    doc.font(FONT_REG).fontSize(9).fillColor(COLORS.ink500)
      .text('Principal KES ' + fmtMoney(l.principal) + ' · ' +
        (Number(l.interest_rate) * 100).toFixed(1) + '% · ' +
        l.term_months + ' month(s) · Status: ' + l.status, 50, doc.y);
    doc.moveDown(0.3);

    const txs = l.transactions || [];
    if (!txs.length) {
      doc.font(FONT_REG).fontSize(9).fillColor(COLORS.ink500).text('No transactions.', 70, doc.y);
    } else {
      const headerY = doc.y;
      doc.font(FONT_BOLD).fontSize(8).fillColor(COLORS.ink500);
      doc.text('DATE', 70, headerY);
      doc.text('TYPE', 180, headerY);
      doc.text('REFERENCE', 260, headerY);
      doc.text('AMOUNT', doc.page.width - 150, headerY, { width: 100, align: 'right' });
      doc.moveDown(0.3);

      txs.forEach(function (t) {
        const y = doc.y;
        doc.font(FONT_REG).fontSize(9).fillColor(COLORS.ink);
        doc.text(fmtDate(t.created_at), 70, y);
        doc.text(t.type, 180, y);
        doc.text(t.mpesa_receipt || t.reference || '—', 260, y);
        doc.font(FONT_MONO).fontSize(9)
          .text('KES ' + fmtMoney(t.amount), doc.page.width - 150, y, { width: 100, align: 'right' });
        doc.moveDown(0.35);
      });
    }

    doc.moveDown(0.8);
  });

  doc.moveDown(1);
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(9)
    .text('This statement is computer-generated. For questions, contact info@zariauhai.com.',
      50, doc.y, { width: doc.page.width - 100 });

  drawFooter(doc, 1);
  doc.end();
}

function streamContributionsStatement(res, data) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  doc.pipe(res);
  doc.font(FONT_REG);

  drawHeader(doc, 'Contributions Statement');
  doc.y = 120;

  // ─── Client info block ───
  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(14).text(data.client.full_name);
  doc.font(FONT_REG).fontSize(10).fillColor(COLORS.ink500)
    .text(data.client.phone + ' · ' + (data.client.email || ''), 50, doc.y);
  doc.text('Account: ' + (data.client.account_number || '—'), 50, doc.y);
  doc.text('Statement period: ' + data.period_label, 50, doc.y);

  doc.moveDown(1.5);

  // ─── Summary cards ───
  const startY = doc.y;
  const w = (doc.page.width - 100) / 3;
  const items = [
    ['Total contributed', 'KES ' + fmtMoney(data.totals.total)],
    ['Contributions', String(data.totals.count)],
    ['Current balance', 'KES ' + fmtMoney(data.totals.balance)],
  ];
  items.forEach(function (it, i) {
    const x = 50 + i * w;
    doc.rect(x, startY, w - 4, 60).fill(COLORS.paperAlt);
    doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(8).text(it[0].toUpperCase(), x + 10, startY + 10);
    doc.fillColor(COLORS.ink).font(FONT_MONO).fontSize(13).text(it[1], x + 10, startY + 28);
  });
  doc.y = startY + 80;

  // ─── Month-by-month table, grouped by year ───
  doc.fillColor(COLORS.navyMid).font(FONT_BOLD).fontSize(12).text('Monthly breakdown');
  doc.moveDown(0.5);

  data.years.forEach(function (yr) {
    // Year heading
    doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(11)
      .text(yr.year + ' — Total KES ' + fmtMoney(yr.total), 50, doc.y);
    doc.moveDown(0.3);

    // Table header
    const headerY = doc.y;
    doc.font(FONT_BOLD).fontSize(8).fillColor(COLORS.ink500);
    doc.text('MONTH', 70, headerY);
    doc.text('DATE', 180, headerY);
    doc.text('REFERENCE', 280, headerY);
    doc.text('AMOUNT', doc.page.width - 150, headerY, { width: 100, align: 'right' });
    doc.moveDown(0.3);

    // Row per month with amount > 0
    let anyRows = false;
    yr.months.forEach(function (m) {
      if (m.amount > 0) {
        anyRows = true;
        const y = doc.y;
        doc.font(FONT_REG).fontSize(9).fillColor(COLORS.ink);
        doc.text(m.label, 70, y);
        doc.text('15 ' + m.label + ' ' + yr.year, 180, y);
        doc.text((m.refs && m.refs[0]) || '—', 280, y);
        doc.font(FONT_MONO).fontSize(9)
          .text('KES ' + fmtMoney(m.amount), doc.page.width - 150, y, { width: 100, align: 'right' });
        doc.moveDown(0.35);
      }
    });

    if (!anyRows) {
      doc.font(FONT_REG).fontSize(9).fillColor(COLORS.ink500).text('No contributions this year.', 70, doc.y);
    }

    doc.moveDown(0.8);
  });

  // ─── Grand total ───
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(COLORS.line);
  doc.moveDown(0.5);
  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(11)
    .text('GRAND TOTAL: KES ' + fmtMoney(data.totals.total), 50, doc.y);

  doc.moveDown(1.5);
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(9)
    .text('This statement is computer-generated. For questions, contact info@zariauhai.com.',
      50, doc.y, { width: doc.page.width - 100 });

  drawFooter(doc, 1);
  doc.end();
}

function streamLoanAgreement(res, data) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  doc.pipe(res);
  doc.font(FONT_REG);

  drawHeader(doc, 'Loan Agreement');
  doc.y = 120;

  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(13).text('Loan Agreement — #' + data.loan.id);
  doc.font(FONT_REG).fontSize(10).fillColor(COLORS.ink500)
    .text('Effective ' + fmtDate(data.loan.approved_at || data.loan.created_at), 50, doc.y);
  doc.moveDown(1.2);

  doc.fillColor(COLORS.navyMid).font(FONT_BOLD).fontSize(11).text('1. Parties');
  doc.moveDown(0.3);
  doc.fillColor(COLORS.ink).font(FONT_REG).fontSize(10);
  doc.text('Lender: Zaria Lending, Nairobi, Kenya.');
  doc.text('Borrower: ' + data.client.full_name + ', ' + data.client.phone +
    (data.client.national_id ? ', ID ' + data.client.national_id : '') + '.');
  doc.moveDown(1);

  doc.fillColor(COLORS.navyMid).font(FONT_BOLD).fontSize(11).text('2. Loan terms');
  doc.moveDown(0.3);
  kvTable(doc, [
    ['Principal', 'KES ' + fmtMoney(data.loan.principal)],
    ['Interest rate', (Number(data.loan.interest_rate) * 100).toFixed(1) + '% flat'],
    ['Term', data.loan.term_months + ' month' + (data.loan.term_months === 1 ? '' : 's')],
    ['Total repayable', 'KES ' + fmtMoney(data.loan.total_repayable)],
    ['Purpose', data.loan.purpose || '—'],
  ]);

  doc.moveDown(1);
  doc.fillColor(COLORS.navyMid).font(FONT_BOLD).fontSize(11).text('3. Repayment schedule');
  doc.moveDown(0.3);

  data.schedule.forEach(function (p, i) {
    doc.font(FONT_REG).fontSize(10).fillColor(COLORS.ink);
    doc.text('Installment ' + (i + 1) + ': KES ' + fmtMoney(p.amount_due) +
      ' due ' + fmtDate(p.due_date), 70, doc.y);
    doc.moveDown(0.3);
  });

  doc.moveDown(1);
  doc.fillColor(COLORS.navyMid).font(FONT_BOLD).fontSize(11).text('4. Terms and conditions');
  doc.moveDown(0.3);
  doc.fillColor(COLORS.ink).font(FONT_REG).fontSize(10).text(
    'The Borrower agrees to repay the loan in full by the due dates shown above. ' +
    'Late payments may incur a fee as disclosed at the time of borrowing. ' +
    'The Borrower authorizes Zaria Lending to contact them via SMS, email, or phone for repayment reminders and overdue notices. ' +
    'Default may result in escalation to a demand letter and, if unresolved, referral to a licensed debt collector.',
    50, doc.y, { width: doc.page.width - 100, align: 'justify' });
  doc.moveDown(1.5);

  const sigY = doc.y;
  doc.strokeColor(COLORS.line).lineWidth(0.5);
  doc.moveTo(70, sigY + 40).lineTo(250, sigY + 40).stroke();
  doc.moveTo(doc.page.width - 250, sigY + 40).lineTo(doc.page.width - 70, sigY + 40).stroke();
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(9);
  doc.text('Borrower signature', 70, sigY + 45);
  doc.text('Date', doc.page.width - 250, sigY + 45);

  doc.moveDown(4);
  doc.moveTo(70, doc.y + 40).lineTo(250, doc.y + 40).stroke();
  doc.moveTo(doc.page.width - 250, doc.y + 40).lineTo(doc.page.width - 70, doc.y + 40).stroke();
  doc.text('For Zaria Lending', 70, doc.y + 45);
  doc.text('Date', doc.page.width - 250, doc.y + 45);

  drawFooter(doc, 1);
  doc.end();
}

function streamDisbursementConfirmation(res, data) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  doc.pipe(res);
  doc.font(FONT_REG);

  drawHeader(doc, 'Disbursement Confirmation');
  doc.y = 120;

  doc.roundedRect(50, doc.y, doc.page.width - 100, 100, 8).fillAndStroke(COLORS.paperAlt, COLORS.line);
  const boxY = doc.y;
  doc.fillColor(COLORS.pos).font(FONT_BOLD).fontSize(11).text('FUNDS DISBURSED', 70, boxY + 18);
  doc.fillColor(COLORS.ink).font(FONT_MONO).fontSize(28)
    .text('KES ' + fmtMoney(data.amount), 70, boxY + 38);
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(9)
    .text('Sent to ' + data.client_phone + ' on ' + fmtDateTime(data.disbursed_at), 70, boxY + 74);
  doc.y = boxY + 120;

  kvTable(doc, [
    ['Loan', '#' + data.loan_id],
    ['Client', data.client_name],
    ['M-Pesa receipt', data.mpesa_receipt || '—'],
    ['Reference', data.reference || '—'],
  ]);

  doc.moveDown(1);
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(9)
    .text('If you did not receive these funds, please contact Zaria immediately on 0746 138 896.',
      50, doc.y, { width: doc.page.width - 100 });

  drawFooter(doc, 1);
  doc.end();
}


// ---------------------------------------------------------------
// Share certificate
// ---------------------------------------------------------------

function streamShareCertificate(res, data) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  doc.pipe(res);
  doc.font(FONT_REG);

  // Navy header
  const pageW = doc.page.width;
  doc.rect(0, 0, pageW, 110).fill(COLORS.navy);

  // Logo chip
  doc.fillColor(COLORS.amber).roundedRect(50, 38, 44, 44, 10).fill();
  doc.fillColor(COLORS.navy).font(FONT_BOLD).fontSize(26).text('Z', 50, 50, { width: 44, align: 'center' });
  doc.fillColor(COLORS.paper).font(FONT_BOLD).fontSize(18).text('Zaria SACCO', 108, 44);
  doc.font(FONT_REG).fontSize(10).fillColor('#B8C0CC').text('Share Certificate', 108, 68);

  // Certificate title
  doc.y = 160;
  doc.fillColor(COLORS.navy).font(FONT_BOLD).fontSize(28).text('SHARE CERTIFICATE', { align: 'center' });
  doc.moveDown(0.5);
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(11).text('Certificate Number: ' + data.certificate_number, { align: 'center' });
  doc.moveDown(1.5);

  // Member name block
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(12).text('This is to certify that', { align: 'center' });
  doc.moveDown(0.5);
  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(24).text((data.full_name || '—').toUpperCase(), { align: 'center' });
  doc.moveDown(0.5);
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(12).text('of ' + (data.phone || '—'), { align: 'center' });
  doc.moveDown(1.5);

  // Holdings block
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(12).text('is the registered holder of', { align: 'center' });
  doc.moveDown(0.5);
  doc.fillColor(COLORS.amber).font(FONT_BOLD).fontSize(48).text(String(data.shares_held), { align: 'center' });
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(12).text('fully paid ordinary shares', { align: 'center' });
  doc.moveDown(1.5);

  // Value summary table
  const tableY = doc.y;
  const margin = 100;
  const tableW = pageW - margin * 2;

  doc.rect(margin, tableY, tableW, 30).fill(COLORS.paperAlt);
  doc.fillColor(COLORS.ink500).font(FONT_BOLD).fontSize(10)
     .text('Par value per share', margin + 12, tableY + 10)
     .text('Total share value', margin + tableW / 2, tableY + 10);
  doc.fillColor(COLORS.ink).font(FONT_MONO).fontSize(12)
     .text('KES ' + fmtMoney(data.par_value), margin + 12, tableY + 42)
     .text('KES ' + fmtMoney(data.total_value), margin + tableW / 2, tableY + 42);

  doc.y = tableY + 80;
  doc.moveDown(1);

  // Issue info
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(10)
     .text('Issued: ' + fmtDate(data.issued_at), { align: 'center' });
  doc.moveDown(2);

  // Signature lines
  const sigY = doc.y;
  const sigW = 180;
  doc.strokeColor(COLORS.line).lineWidth(0.5);
  doc.moveTo(margin + 20, sigY + 40).lineTo(margin + 20 + sigW, sigY + 40).stroke();
  doc.moveTo(pageW - margin - 20 - sigW, sigY + 40).lineTo(pageW - margin - 20, sigY + 40).stroke();
  doc.fillColor(COLORS.ink500).font(FONT_REG).fontSize(9)
     .text('Director', margin + 20, sigY + 45)
     .text('Date', pageW - margin - 20 - sigW, sigY + 45);

  doc.moveDown(3);
  doc.moveTo(margin + 20, doc.y + 40).lineTo(margin + 20 + sigW, doc.y + 40).stroke();
  doc.moveTo(pageW - margin - 20 - sigW, doc.y + 40).lineTo(pageW - margin - 20, doc.y + 40).stroke();
  doc.text('Secretary', margin + 20, doc.y + 45)
     .text('Date', pageW - margin - 20 - sigW, doc.y + 45);

  drawFooter(doc, 1);
  doc.end();
}

module.exports = {
  streamReceipt,
  streamStatement,
  streamContributionsStatement,
  streamLoanAgreement,
  streamDisbursementConfirmation,
  streamShareCertificate,
};
