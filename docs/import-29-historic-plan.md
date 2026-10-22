# Import 29 Historic Members — Master Plan
**Version:** 1.0
**Date:** 2026-10-21
**Status:** DRAFT — awaiting approval before execution

---

## 1. Objective

Bring the 29 XLSX members who do not yet have a client record into the
Zaria Uhai SACCO database so that:

- The SACCO's financial totals (savings, shares, reg fees) are complete
- Admin can see every historic member in /admin/clients, /admin/savings, etc.
- Historical financial ledgers are preserved (they can be printed as statements)
- The members can request their account to be created or merged when they
  later want to use the app

**What this does NOT do:**

- Does not give historic members login access
- Does not require email collection from the SACCO
- Does not touch the 7 clients already in DB (6, 12, 15, 16, 17, 18, 23)
- Does not import chama membership (unresolved in XLSX)
- Does not import dividends (none declared yet)

---

## 2. Data model per historic client

For each of the 29, create:

### 2.1 — Placeholder user


---

## Execution Log — 2026-10-21 14:37

**Phase 1 (import) COMPLETED and COMMITTED**

- Backup: ~/zaria-backup-pre-28import-20261021-143753.sql (must be on laptop)
- File executed: imports/import-28-historic-members.sql
- COMMIT: 2026-10-21 14:37
- Result: 38 clients (10 + 28), all V1-V7 checks passed
- Muasya Muange (memno 13) EXCLUDED pending XLSX 255,000 clarification

**Post-commit state:**
- clients: 38
- users: 39 (11 + 28)
- historic placeholder users: 28
- savings_accounts: 38
- savings_transactions: 155
- share_holdings: 10
- share_transactions: 10
- registration_fees: 35

**Next: Phase 2 (merge UI)** — pending next session.
