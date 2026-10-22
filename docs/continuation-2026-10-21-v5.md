═══════════════════════════════════════════════════════════════
ZARIA UHAI SACCO — MASTER CONTINUATION PROMPT v5
Generated: 2026-10-21 (session end)
Based on: v3 → all work through 2026-10-21
═══════════════════════════════════════════════════════════════

# SECTION 0 — READ THIS FIRST

You are resuming development on "Zaria Uhai SACCO" — a full-stack
lending + savings + shares + dividends + chama PWA for a Kenyan
SACCO. All context through 2026-10-21 is captured here.

CRITICAL RULES:
1. DO NOT re-invent anything. DO NOT "improve" without asking.
2. DO NOT skip verification steps.
3. DO NOT run SQL that DELETEs or UPDATEs without explicit user
   confirmation AND a fresh backup downloaded off-server.
4. Before making changes, READ the file first and report analysis.
5. Use `node --check` on every JS file after every edit.
6. **When rewriting a file, use `cat > file <<'EOF'` heredoc — NOT
   perl/sed patches.** This session proved perl-on-JS is a
   whack-a-mole disaster.
7. Never paste JS into bash. Always heredoc with quoted delimiter.
8. **Joseph Ngei = jp zaria = client_id 6** (national_id 24239998)
9. **In mysql transactions: NEVER leave COMMIT or ROLLBACK in a
   heredoc that runs non-interactively.** Use plain `mysql -e
   "INSERT..."` for one-offs, or interactive mysql + manual COMMIT
   for real imports.

═══════════════════════════════════════════════════════════════
# SECTION 1 — PROJECT IDENTITY
═══════════════════════════════════════════════════════════════

Business: Zaria Uhai SACCO (Kenyan savings + credit cooperative)
Domain: https://zariauhai.com
Server: rbx119.truehost.cloud
Hosting: Truehost shared cPanel, Node.js via Passenger + LiteSpeed
cPanel user: tvkbtmov
Node venv: /home/tvkbtmov/nodevenv/zaria/24/bin/
App root: /home/tvkbtmov/zaria/
Node version: v24.21.0
Server timezone: UTC (display dates in EAT for Kenya)
Currency: KES (whole amounts for M-Pesa; DECIMAL(15,2) in DB)
Phone format: 2547XXXXXXXX (no leading +, no leading 0)

Current state: Production-ready. 38 clients (10 active + 28
historic). Phase 2 merge UI complete and tested.

═══════════════════════════════════════════════════════════════
# SECTION 2 — ENVIRONMENT CREDENTIALS
═══════════════════════════════════════════════════════════════

⚠️⚠️⚠️ ALL SECRETS IN v3 DOC + THIS SESSION TRANSCRIPT ARE
COMPROMISED. NOTHING HAS BEEN ROTATED YET. ROTATE FIRST THING
NEXT SESSION.

## Database
Host: localhost (NOT 127.0.0.1 — IPv6 issue)
Port: 3306
DB: tvkbtmov_zaria
User: tvkbtmov_zariauser
Password: Zaria2026!Secure  ← ROTATE
Charset: utf8mb4 / utf8mb4_unicode_ci

## Admin account
Email: zariauhaisacco@gmail.com
Password: YourStrongAdminPassword2026!  ← ROTATE
User ID: 1

## Email (cPanel SMTP)
Host: mail.zariauhai.com
Port: 587 (STARTTLS)
User: info@zariauhai.com
Password: ZariaMail2026!Secure  ← ROTATE
From: "Zaria" info@zariauhai.com

## Ping Africa (SMS + WhatsApp + USSD)
Token: 141|wXNyWZHfMx6FLX5DCh9fnAYGrSZF7sAZePtyDWtK47bc48e8  ← ROTATE
Sender ID: PING-AFRICA
Base URL: https://bulk.ping.africa/api

## VAPID (push)
PUBLIC_KEY: BGGqgXTPU_BovUL01suMB9PJqj2pTlf1G-TMKNzUDb6ulf
nMTJ04I6ZsQ3Vz2FrhHfshJV0dsWQgB6dS5ho-Fdw
PRIVATE_KEY: qmEN9NY4FmuAIloF5eNeCG5BF8FOKeYZ44SH0cYSEqE  ← ROTATE
SUBJECT: mailto:info@zariauhai.com

## Encryption key (AES-256-GCM)
APP_ENCRYPTION_KEY=cd890c57ccac6e3bedabd629ab77e62a3573fb792e792458f4a20100253e1216
⚠️ If lost, encrypted Daraja credentials become unreadable.

## Daraja Sandbox — STK Push (working)
Consumer Key: sRL0xwEYfYufDbj3m8ZoQ760DJiTzraRXmGlk9aTmOcUFf5o
Consumer Secret: M9zEbTi3QWqDzH4GZ9Bwk4TBlWssBmA6bI8dInQTzeLDAPXFs5WvsO78vSnlnNXf
Passkey: bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
Shortcode: 174379
Callback: https://zariauhai.com/api/daraja/callback

## Daraja Sandbox — B2C (blocked on SecurityCredential)
Consumer Key: yAfJKA27N0i5EuTlquHVp3IPPS3KwXgpCGCa9ceTcIYKeVwZ
Consumer Secret: ThzSMh7D2FPEbVk8uAA6qpTwPA216TJDfSZc4FRx7O2DoAFULkxIgjyU9csgymht
B2C Shortcode: 600998, Initiator: testapi / Safaricom123!!

═══════════════════════════════════════════════════════════════
# SECTION 3 — SESSION 2026-10-21 ACCOMPLISHMENTS
═══════════════════════════════════════════════════════════════

## Data Integrity (COMPLETED)

### Client 6 (Joseph Ngei) savings rebuild
- From even-split (41,500) to XLSX-exact (43,500)
- 18 transactions, running balance verified

### Share transactions gap
- Added missing share_transactions for clients 6, 12, 17, 18

### 28-member historic import (COMMITTED)
- 28 historic members from XLSX (Muasya excluded — see §8)
- Each has: placeholder user (member-<memno>@zaria.local,
  unloginable password), client record, savings account, monthly
  transactions, share holdings (6 members), reg fee
- Post-import: 38 clients, 39 users, 155 savings_txns
- Totals: savings 85,900 / shares 7,300 / reg fees 13,600

═══════════════════════════════════════════════════════════════
# SECTION 4 — CLIENT PORTAL FEATURES SHIPPED
═══════════════════════════════════════════════════════════════

## Contributions page `/client/savings`
- Year tabs (2026, 2025), 12-month grid, CSV download
- Endpoints: GET /api/me/savings/monthly, /monthly.csv
- Dashboard link: "This year: KES X · view contributions"

## Shares page bug fix
- client-shares.js: `var h` used before declaration

## Shared client sidebar `public/js/sidebar-client.js`
- One file, all 12 client pages
- Order: Overview / My loans / My contributions / Transactions /
  My shares / My dividends / Profile + Request loan / Chama /
  Statements
- Active item highlights via window.location.pathname

═══════════════════════════════════════════════════════════════
# SECTION 5 — ADMIN PORTAL FEATURES SHIPPED
═══════════════════════════════════════════════════════════════

## Badge fixes
- Requests badge: hardcoded dot → data-driven pending_loan_requests
- Loans badge: added warn class
- Registrations: data-driven

## Icon fixes
- Chamas SVG malformed path fixed
- Dividends/Broadcasts icons added
- Registrations: distinct icon

## Admin savings yearly view
- `/api/admin/savings/monthly` endpoint
- Yearly grid on `/admin/savings` (matches client page)

## Phase 2 — Merge UI (COMPLETE)
- GET /api/admin/registrations/:id/candidates — auto-detect
  matches on national_id → phone → full_name
- GET /api/admin/registrations/historic/search?q= — manual search
- POST /api/admin/registrations/:id/merge — transaction updating
  historic user email + password, client phone + ID, marking
  registration approved
- Modal redesigned: candidates section + search + 4 action paths
  (merge / create new / reject / cancel)
- Audit logged as `registration.merged_with_historic`
- Tested with Celestine Muli (client 34) — merged, then reset


═══════════════════════════════════════════════════════════════
# SECTION 6 — HISTORIC CLIENTS: HOW THEY WORK
═══════════════════════════════════════════════════════════════

## Identifying historic clients
```sql
SELECT c.id, c.full_name, c.phone, c.national_id, u.email
  FROM clients c JOIN users u ON u.id = c.user_id
 WHERE u.email LIKE 'member-%@zaria.local'
 ORDER BY c.id;

═══════════════════════════════════════════════════════════════
# ADDENDUM 2026-10-21 16:30 — Chama imports + status fix
═══════════════════════════════════════════════════════════════

## Chamas created (from XLSX Groups Registration names)
- Tukwatane SH Group (id=19, CHM-0019)
- Muathime SHG (id=20, CHM-0020)
- Muo wa Atui SHG (id=21, CHM-0021)
- Baraka SHG (id=22, CHM-0022)
- Kanini Kaseo SHG (id=23, CHM-0023)
- Jekan SHG (id=24, CHM-0024)
- Wendano Women SHG (id=25, CHM-0025)
- Woderful SHG (id=26, CHM-0026)
Plus existing Leric Group (id=2, CHM-0002)

## Bug fixed: nextAccountNumber
`chama.js` `nextAccountNumber()` was using `COUNT(*)+1` — always
produced CHM-0002, always collided with Leric. Fixed to use
`chama_id` for guaranteed uniqueness. All future chamas get
`CHM-<chama_id>`.

## Tukwatane group registration fee (+2,500)
- Imported as group-level adjustment (client_id=NULL)
- Reference: XLSX-GROUP-REG-1
- Balance: 0 → 2,500

## Chama data NOT imported (blocked on source data)
- 7 × negative group reg fees (-2,500 each) — ambiguous
- Muathime 2,400 + Kanini Kaseo 1,450 contributions —
  contributor identity unknown
- Member-to-chama mappings — not in XLSX

## Client status enum expanded
- Added 'pending_merge' to clients.status
- 28 historic clients marked status='pending_merge'
- 10 real clients remain status='active'
- Merge endpoint updated to set status='active' on merge

## Outstanding chama data needed from SACCO
1. Member-to-chama mappings
2. Clarification on -2,500 group registration fees
3. Contributor identity for Muathime 2,400 / Kanini Kaseo 1,450

═══════════════════════════════════════════════════════════════
# SECTION 12 — BACKUPS ON SERVER
═══════════════════════════════════════════════════════════════

## Database dumps (~/zaria-backup-*.sql)
- zaria-backup-pre-cleanup-20261021-083522.sql
- zaria-backup-pre-import-20261021-095510.sql
- zaria-backup-pre-joseph-20261021-105043.sql
- zaria-backup-pre-jpzaria-final-20261021-110933.sql
- zaria-backup-pre-rebuild-20261021-123857.sql
- zaria-backup-pre-28import-20261021-143753.sql
- zaria-backup-post-28import-*.sql
- zaria-backup-post-chamas-20261021-161411.sql
- zaria-backup-pre-tukwatane-statusfix-20261021-162132.sql

## Code backups (_backups/)
- _backups/pre-contrib-20261021/
- _backups/nav-refactor-20261021/
- _backups/nav-refactor-20261021/post-migration/
- _backups/admin-sidebar-20261021/
- _backups/merge-phase2-20261021/

## User must have downloaded to laptop
- At minimum zaria-backup-post-chamas-20261021-161411.sql

═══════════════════════════════════════════════════════════════
# SECTION 13 — OUTSTANDING TASKS (PRIORITY)
═══════════════════════════════════════════════════════════════

## IMMEDIATE (before real launch)
1. **ROTATE ALL SECRETS** — DB password, admin password, Ping
   Africa token, VAPID keys, email password, APP_ENCRYPTION_KEY.
   All exposed in v3 doc + 2026-10-21 transcript + this v5 doc.
   ⚠️ Changing APP_ENCRYPTION_KEY requires re-encrypting Daraja
   secrets stored in app_settings.

2. **Confirm Muasya Muange's Mar 2026 amount** (255,000 anomaly
   in XLSX monthly contributions). Excluded from 28-member import.

3. **SACCO to provide chama member mappings** — XLSX has no
   member-to-chama list. All 8 new chamas at 0 members.

4. **SACCO to clarify -2,500 group registration fees** — 7 of 8
   groups show -2,500 in XLSX. Not imported.

5. **SACCO to identify contributors** for Muathime 2,400 (Sep)
   and Kanini Kaseo 600+850 (Sep+Oct). Not imported.

## MEDIUM (feature polish)
6. Client SMS preferences page (/client/profile toggle)
7. Weekly SMS digest cron (Sunday 9am)
8. SMS reports page (/admin/reports/sms)
9. B2C SecurityCredential — email Safaricom for real value
10. Admin 2FA — TOTP
11. WhatsApp Business + USSD shortcode approval (Ping Africa)
12. PDF statement on contributions page

## LONG-TERM
13. Backup automation (daily → remote storage)
14. Admin shared sidebar refactor
15. Admin dashboard "Recent activity" — non-loan events
16. Chart on client contributions page

═══════════════════════════════════════════════════════════════
# SECTION 14 — VERIFICATION WORKFLOW
═══════════════════════════════════════════════════════════════

## Session start
```bash
source /home/tvkbtmov/nodevenv/zaria/24/bin/activate
cd /home/tvkbtmov/zaria
which node && node -v   # must be v24.21.0
node --check <file> && echo "✅ syntax OK"
















═══════════════════════════════════════════════════════════════
# SECTION 7 — CLIENTS IN DB (38 total)
═══════════════════════════════════════════════════════════════

## Active clients (10) — status='active', real email, real password
IDs: 1, 3, 6, 12, 14, 15, 16, 17, 18, 23

## Historic clients (28) — status='pending_merge', placeholder email
All have user email `member-<memno>@zaria.local` and cannot log in.
Membership numbers: 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18,
19, 20, 21, 23, 24, 25, 26, 27, 28, 29, 30, 31, 33, 34, 35, 36
(client IDs 26-51).

When a real person signs up matching a historic client, admin
merges via /admin/registrations → status flips to 'active'.

═══════════════════════════════════════════════════════════════
# SECTION 8 — MUASYA MUANGE: EXCLUDED
═══════════════════════════════════════════════════════════════

XLSX member #13 Muasya Muange has an anomaly in monthly
contributions:
  2026 row: 0, 5000, 255000, 500, 500, 500, 1000, 1000, 1800,
            1000, 0, 0
The 255,000 for Mar 2026 is ~500x surrounding months.
Almost certainly a typo (missing decimal or extra zeros).

ACTION REQUIRED: SACCO must confirm real Mar 2026 amount
(500? 2,500? 255,000?) before Muasya is imported.

Currently EXCLUDED from the 28-member import.

═══════════════════════════════════════════════════════════════
# SECTION 9 — CHAMA DATA STATUS
═══════════════════════════════════════════════════════════════

## 9 chamas exist (was 1, now 9)
- Leric Group (id=2, CHM-0002) — 2 members, 0 balance
- Tukwatane SH Group (id=19, CHM-0019) — 0 members, balance 2,500
- Muathime SHG (id=20, CHM-0020) — 0 members, balance 0
- Muo wa Atui SHG (id=21, CHM-0021) — 0 members, balance 0
- Baraka SHG (id=22, CHM-0022) — 0 members, balance 0
- Kanini Kaseo SHG (id=23, CHM-0023) — 0 members, balance 0
- Jekan SHG (id=24, CHM-0024) — 0 members, balance 0
- Wendano Women SHG (id=25, CHM-0025) — 0 members, balance 0
- Woderful SHG (id=26, CHM-0026) — 0 members, balance 0

## What's imported
- Tukwatane +2,500 group registration fee (XLSX-GROUP-REG-1,
  client_id=NULL, type=adjustment)

## What's NOT imported (blocked on source data)
1. 7 x negative -2,500 group registration fees — ambiguous sign
2. Muathime 2,400 (Sep 2026) contribution — contributor unknown
3. Kanini Kaseo 600+850=1,450 (Sep+Oct 2026) — contributor unknown
4. Member-to-chama mappings — XLSX has no such mapping

## Schema notes
- chama_savings_transactions.client_id NULL allowed (group entries ok)
- chama_contributions.client_id NOT NULL (needs real contributor)
- nextAccountNumber() bug fixed: was COUNT(*)+1, now uses chama_id

═══════════════════════════════════════════════════════════════
# SECTION 10 — DATABASE SCHEMA NOTES
═══════════════════════════════════════════════════════════════

## clients table
- user_id BIGINT UNSIGNED NOT NULL UNIQUE
- phone VARCHAR(20) NOT NULL
- status ENUM('active','suspended','closed','pending_merge')
  (pending_merge added 2026-10-21 for historic imports)

## users table
- NO status column. Disable = unusable password_hash + undeliverable
  email (@zaria.local bounces)
- password_hash for historic: `$2a$12$NOTAREALHASH...` (bcrypt fails)

## audit_logs
- old_values JSON NULL, new_values JSON NULL
- audit.log({ oldValues, newValues }) accepts objects

## share_transactions
- FK column is holding_id, NOT client_id
- Path: share_holdings.client_id → share_transactions.holding_id

## pending_registrations
- status enum: pending/approved/rejected/expired
- created_user_id set on approve (new user) OR merge (existing)

═══════════════════════════════════════════════════════════════
# SECTION 11 — API ENDPOINTS
═══════════════════════════════════════════════════════════════

## Admin — registrations
GET  /api/admin/registrations?status=pending|approved|rejected|expired|all
GET  /api/admin/registrations/:id
GET  /api/admin/registrations/:id/candidates
GET  /api/admin/registrations/historic/search?q=
POST /api/admin/registrations/:id/merge
POST /api/admin/registrations/:id/approve
POST /api/admin/registrations/:id/reject

## Client — savings
GET  /api/me/savings
GET  /api/me/savings/eligibility
GET  /api/me/savings/monthly
GET  /api/me/savings/monthly.csv

## Admin — savings
GET  /api/admin/savings/accounts
GET  /api/admin/savings/monthly
GET  /api/admin/savings/accounts/:id
POST /api/admin/savings/accounts/create
POST /api/admin/savings/accounts/:id/deposit

## Admin — stats
GET /api/admin/stats — includes:
  pending_loans, pending_loan_requests, pending_registrations
  sms_today, sms_this_month, sms_credits_balance
  chama_active, chama_members, chama_balance, chama_payouts_*

## Chama admin
GET/POST  /api/admin/chamas
GET/PATCH /api/admin/chamas/:id
GET/POST  /api/admin/chamas/:id/members
GET/POST  /api/admin/chamas/:id/contributions
GET       /api/admin/chamas/:id/transactions

═══════════════════════════════════════════════════════════════
# SECTION 15 — WHAT NOT TO BUILD
═══════════════════════════════════════════════════════════════

❌ Crypto, Card payments, Blockchain, Social login
❌ Automated loan approval
❌ Wallet beyond current savings
❌ Native mobile app (PWA covers all)
❌ React/Vue/Angular (vanilla JS deliberate)
❌ Redis, PM2, Docker, TypeScript, ORM, CSRF library
❌ BCrypt native (bcryptjs for portability)

═══════════════════════════════════════════════════════════════
# SECTION 16 — HOW TO TALK TO ME
═══════════════════════════════════════════════════════════════

- I cannot see your terminal — paste outputs
- I cannot run commands — you run them
- I cannot see the DB — you query and paste
- I cannot see the browser — you describe or paste console

When you want me to change something:
"Change X in file Y. Here's current content: [paste]"
I'll: read, analyze, propose patch, wait for run, verify.

When something breaks:
- Paste full error output (not just last line)
- Paste the command that produced it
- Paste any recent changes

═══════════════════════════════════════════════════════════════
END OF CONTINUATION PROMPT v5
═══════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════
# ADDENDUM 2026-10-22 — Three features: PDF, chart, weekly digest
═══════════════════════════════════════════════════════════════

## 1. PDF contributions statement
- Endpoint: GET /api/contributions?year=YYYY|all
- Service: streamContributionsStatement() in app/services/pdf.js
- Access: client (own only), admin (any via ?client_id=)
- UI: "Download PDF" button on /client/savings
- Tested: all 7 cases pass

## 2. Monthly chart on /client/savings
- Inline SVG bar chart (no library)
- 12 vertical bars for selected year
- Amber fill for paid months, grey for zero months
- Amount labels above bars, month labels below
- Auto-updates on year tab switch
- Files: savings.html (chart card), client-savings.js (renderChart), app.css

## 3. Weekly digest email cron
- File: app/jobs/weekly-digest.js
- Cron: 0 6 * * 0 (Sunday 09:00 EAT)
- Email-only (no SMS cost)
- Per-client content: savings, weekly contributions, shares, loans, chama
- Sends to all 11 active clients (10 original + Mary)
- --dry-run flag for testing
- Tested: all 11 digests render correctly
- Test send delivered to jp zaria + Mary Wanjiku

## Route mount correction
- pdf.js mounted at /api (NOT /api/pdf)
- Endpoint: /api/contributions (not /api/pdf/contributions)
- Existing certificate route: /api/certificate/:clientId

## Outstanding after this session
- Rotate all secrets (DB pw, admin pw, phone in transcript, Ping token, VAPID)
- Verify email deliverability (check SPF/DKIM/DMARC if digests land in spam)
- Mary wambui's email is bobohmarie254@gmail.com — differs from signup
  bobomarie254@gmail.com (missing 'h'). Needs verification.

═══════════════════════════════════════════════════════════════
# ADDENDUM 2026-10-22 — Git commit + push
═══════════════════════════════════════════════════════════════

## Commit
- Hash: c6bb1df
- Branch: main
- Remote: github-zaria:zariauhaisacco-dev/zariaapp.git (private)
- Files: 108
- Message: "feat: admin 2FA, PDF statements, weekly digest, chama module"

## Pushed to GitHub successfully
- Local HEAD = remote HEAD = c6bb1df
- Nothing sensitive leaked (all 5 safety checks pass)

## .gitignore reinforced
Added patterns to prevent future leaks:
- .env.before-*, .env.deduped, .env.*.bak
- *.bak2-*, *.before-*
- imports/, *.import.sql
- cleanup-*.sql, fix-*.sql, rebuild-*.sql
- recover-row-*.js, dry-run-*.js
- public/images/*-original.png (raw source images)

## Moved out of repo (not committed)
- 6 .env backup files → ~/zaria-env-backups/
- 9 test SQL/JS files → ~/zaria-test-artifacts-20261022/
- 4 imports/*.sql files → ~/zaria-test-artifacts-20261022/imports/
- 2 .bak code files → ~/zaria-test-artifacts-20261022/
