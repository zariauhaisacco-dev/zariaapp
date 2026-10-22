# Chama Data — Pending Import from XLSX

## What's imported
- 8 chama records created (empty, 0 members, 0 balance)
- Accounts: CHM-0019 through CHM-0026

## What's NOT imported (blocked on missing source data)

### 1. Member-to-chama mappings
XLSX Groups Registration sheet only has group names. No individual
member list. Need SACCO to provide: which client belongs to which
chama.

Currently in DB:
- Leric Group (id=2): 2 members
- All other chamas: 0 members

### 2. Group registration fees
XLSX Groups Registration:
- Tukwatane: +2,500
- Muathime: -2,500
- Muo wa Atui: -2,500
- Baraka: -2,500
- Woderful: -2,500
- Kanini Kaseo: -2,500
- Jekan: -2,500
- Wendano: -2,500
- TOTAL: -15,000

The -2,500 on 7 of 8 groups is nonsensical as a real fee. Need SACCO
to clarify:
  (a) Error — should be +2,500 each
  (b) Credit memos
  (c) Never paid — should be 0
  (d) Other

### 3. Group contributions
XLSX Group Contribution:
- Tukwatane CIG: 0 (nothing to import)
- Muathime CIG: 2,400 (September 2026)
- Kanini Kaseo: 600 (September) + 850 (October) = 1,450

Cannot import without knowing WHO paid each amount. Chama
contributions require client_id (which member's payment was it).

## Action needed from SACCO
1. Member-to-chama mapping (name or client_id per group)
2. Clarify -2,500 group registration fee anomaly
3. Contributor names for Muathime 2,400 and Kanini Kaseo 1,450
