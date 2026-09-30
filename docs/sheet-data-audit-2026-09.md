# Sheet data audit — September 2026

Youssef, 2026-09-29: "we have ring central calls and leads and signups and tasks, that's the only
automated things, so we need the other data to be accurate." Seven read-only auditors compared the
live Centralized BDR/FR workbook with production on 2026-09-29 (the "unread tabs" auditor did not
finish). This is the condensed result: what's wrong, what's fixed, what's left. Line numbers are as of
commit dc98fcf. No client names here on purpose — the audits have row numbers to find them.

How the data gets in: `server/dataSync.ts` `runSheets` every 8 hours runs
`sync-facilities-additive.mjs` → `import-calls-from-excel.mjs` → `import-bdr-from-excel.mjs` →
`repair-data.mjs --apply`. The importers **delete each table and re-insert it** (except
`outbound_referrals`, which is keyed and updated in place), so `createdAt` is the import time, ids
change every run, and anything created or edited in the app on those tables is lost at the next sync.

## Already done

- **Admin Overview** (`/bdr/admin`, `server/adminOverview.ts`, aa6a4ab): real team, date presets,
  Pacific months, rewards dated by SUD, impossible dates (year 0206, Dec 2026) kept out of months and
  counted, "latest entry" per dataset.
- **Expenses** (`/bdr/expenses`, `server/expensesView.ts`, dc98fcf): **Youssef chose "Sheet only"** —
  the sheet is the one place expenses are entered; the page is read-only with an "Open the sheet"
  link; create/update/delete procedures removed (also from the Field App). Fixed: "Quee" → Queenie
  (importer `rep()` now maps a lone shortened first name via `canonical`), BDR report month stored as
  "June 2026" not the serial "46174", date range includes its last day.

## Urgent

**Duplicate calls — live now.** Someone pasted Miguel's Aug 24 – Sep 28 RingCentral export (609 rows)
into `2.RC` after the Sep 29 18:39 UTC sync, and re-pasted 85 August rows (2.RC rows 12182–12266 copy
11546–11657). The Sep 30 11:14 UTC sync imported them: sheet calls went from 11,542 to 11,780
(`contact_logs` 4,970 + `rc_unmatched_calls` 6,810 with `rcCallId LIKE 'xls:%'`); Sept alone has 172
that live RingCentral already holds. RingCentral is live from Aug 27 (Queenie) / Aug 28 (others).

Fix (code, `scripts/migration/import-calls-from-excel.mjs`): skip 2.RC rows dated on or after the
RingCentral go-live (2026-08-27), and dedupe on rep + minute + number (the current overlap check at
:129–141 can't see internal extensions, shared numbers or blank inbound numbers, or duplicates inside
the sheet). Because the importer wipes `xls:` rows each run, the next sync after deploy removes all
238 plus the 39 older Aug 27–31 duplicates. No data repair needed. Team: stop pasting RingCentral
exports into 2.RC after Aug 27.

## Code fixes, by dataset (most important first)

### Calls (`import-calls-from-excel.mjs`)
1. The cut-off/dedupe above.
2. Direction is hard-coded 'Outbound' (:159, :167): 2,793 inbound "Phone Call" rows stored as
   outbound. Take it from the Action column.
3. Result mapping (:57) reads "disconnected" as connected: 51 "Wrong Number" calls stored as connected.
4. Column L (a formula) is trusted over column B (:86); a `#REF!` at L6862 misfiles 37 calls on Jun 5–6.
   Use B first.
5. Hashtag dropped for unmatched calls; partner-search / #BDRPNC / #uber become 'other' (:63–72).
   Internal extension calls (2,177) sit in the Daily Work "assign" queue; `crmDb.ts:619` should ignore
   numbers under 10 digits. Call Activity (`teamReports.ts:329`) leaves out unmatched calls, which is
   why its August totals are about half the sheet's.

### Referral rewards (`import-bdr-from-excel.mjs` rewards block, `server/reports.ts`, `server/db.ts`)
1. **Dates:** `createdAt` = import time, and `reports.ts:124–126,182` and `db.ts:547–558` filter on it,
   so "This month" shows every reward ever and past ranges show none. Import Date Requested (A), Date
   Paid (L) and Processed amount (K); until then write `createdAt = requested ?? paid ?? SUD`.
2. **Status:** in rows 67–84, 89, 135, 136 the status was typed in H and an amount in I, so 17 Accepted
   (+$6,500) and 1 Denied are stored as Pending. Fall back to H when I is numeric; keep Disputed / NA
   as their own values.
3. Continuation rows with a blank rep become "(unknown)" (13 rows, $6,500): take the rep from the row
   above.
4. The /bdr/referral-rewards page still offers Add/Edit/Delete (wiped every sync) and a stale rep list
   (`ReferralRewards.tsx:18`).
5. Partner matching is exact-name only: strip " - contact name" suffixes, prefer the rep's own
   partners (two Bakersfield rewards are on a Victorville facility, #1037).
6. **Decision for Youssef:** what "Payouts" means — accepted `payoutAmount` ($61,156), all
   `payoutAmount` ($88,383, what dashboards show), or money actually processed (column K, $71,342).
   Split purchases repeat the full amount on each row. Ask before changing what's counted.

### Referral-friendly referrals (`import-bdr-from-excel.mjs` L139–152, L246–252, L310–343)
1. "Pending Demo" is counted as sent (11 rows); "Scheduled Appointment" as pending (2). Fix the mapping.
2. Date Sent typed as text ("Sent 11/14/2025") is thrown away: ~45 dates, 13 leads in the wrong month,
   93 notes lost; K91 is 2027. Parse the text, reject future years, keep column K in notes.
3. Referral Reports (`db.ts:807–857`) count all 189 rows as "sent" and group by raw facility text;
   the Referral-Friendly Tracker page offers Add/Edit/Delete on a wiped table and its "Partner
   Facilities" card is always 0 (`ReferralTracker.tsx:120`).
4. The tab stops at 3/19/2026 — ask the team where referrals are logged since.

### FR visits and errands (`import-bdr-from-excel.mjs` :154–187)
1. **Errand status bug (:161):** `includes("complete")` matches "Not Completed" — 58 errands shown
   Completed. The next sync corrects them once fixed.
2. **No FR visits since 3/31** in the sheet (FRs still log visit lunches). `VisRefExp` has 170 visits
   Apr 1–27 and isn't imported. Ask the team where visits go now; Marisol has no block in 2.Visits.
3. "FR Errand …" / "Admin work" lines are stored as visited facilities (77); a sheet count of 0
   becomes the number of lines; hours have no sanity check (a typed "3" became 72 h).
4. Only 23% of visited partners are linked (name-only matching, :351 passes phone "").

### Partner facilities (`sync-facilities-additive.mjs`)
1. **Reads the wrong tabs.** The master list is `1.Fclty DD` (1,780 rows, owner in A, status in P);
   the importer never reads it and reads a stale pasted `Active partners`, a filtered view
   `1.Fcilty Typ` whose columns it maps wrongly (phones stored as emails on 190 facilities, phone 2 in
   notes on 20), and archived lists. 765 master facilities are missing (47 partners); 273 owners and
   69 statuses differ. **Decision for Youssef first:** switching to `1.Fclty DD` adds ~765 facilities
   (mostly prospects/DNC), and he must say whether the sheet or the CRM decides owner and status
   (Marisol's reassignment exists only in the CRM; the sheet still says Genysys on 63 rows).
2. Matching: phone first incl. phone2/3, first match wins with no ORDER BY — 54 rows land on the wrong
   facility though one with the exact name exists (e.g. Valenz #599 vs Erick #367).
3. Only fills blanks and only promotes status, so reassignments and Inactive/DNC never arrive.

### Expenses (`import-bdr-from-excel.mjs` :76–92)
- Done: see above. Left: the other list endpoints in `server/db.ts` (:425, :465, :506, :549, :589,
  :632) still end "to" dates with `setHours(23,59,59)` on the Pacific-clock server, dropping the last
  day. The Uber Eats CSV import and webhook insert into `fr_expenses`, which the sync wipes —
  **decision for Youssef** (the sheet already has the Uber Eats orders).

### Everywhere
- Replace delete-and-reinsert with keyed upserts (the way `outbound_referrals` works, :245–303), one
  transaction per table, and make the script exit non-zero on failed inserts — today `load()` swallows
  errors and `dataSync.ts:160` reports "ok".

## Sheet corrections for the team

- **2.RC:** delete A12182:M12266 (re-pasted) and duplicates 1896, 2118, 4200, 4746, 4915, 4916; fix
  L6862/M6862 (`#REF!`) and re-fill L6863:L6905; stop pasting RingCentral exports after Aug 27.
- **2.Rfral Rewrd:** swap H and I in rows 67–84 and 89; status for I135, I136; C37 and C63 2026 → 2025;
  C93, C94 "3/23/0206" → 3/23/2026; check C39–C42, C55; L155 2020 → 2026; L138 2025 → 2026; one date
  per row in C51, C112, C132; fill the rep on continuation rows 56, 57, 99, 100, 121, 122, 124, 125,
  156–158, 167, 172.
- **2.FR Errand:** A32, A33, A38, A45, A78, A79 are Dec 2026 (should be 2025); A154 "c", A186
  "8/2/8/2026", A182 year 5026, A96–A98 and A196 blank; FR missing in E55, E92, E121, E122, E125, E186;
  status blank F92, F122; confirm duplicate pairs 31/34, 120/138, 131/132.
- **2.Visits:** hours D36, T37, T46 over 24 h; L8 blank.
- **2.Rfral Frndly fclt:** K91 2027 → 2026; K63, K90, K108 year 2025 → 2026; delete rows 105–108
  (copies of 87–90); J45 → Unsuccessful; J96 is an inbound lead; final status for 5, 7, 9, 10, 13, 24, 58.
- **2.BDR Expen:** B117:B125 2025 → 2026 ($1,039.91 missing from Jan 2026); C631 no BDR; H532 no amount.
- **2.FR Expen:** B1370:B1371 2025 → 2026; C1035 "Quee"; FR row 1743 has no date or rep; amounts blank
  in I1398, I1417, I1694; duplicate block at rows 5748–5765 (5749, 5761, 5762–5765 copy earlier rows).
- **Active partners:** G466:H466 714774600 → 7147746000, K466 fimapt → femapt; C381:F383 three
  "RM Collision" rows carry other shops' phones.
- **2.Agent Dash:** AC6 uses $Q8 and AC8 uses $Q6 (swap).
- **1.Fclty DD:** rename P9 "pues dales" → "Status"; 49 duplicate rows; 424 rows without a city.

## Waiting on Youssef

- Payouts definition (rewards).
- Facilities: import from `1.Fclty DD`? Sheet or CRM decides owner/status?
- Uber Eats import and Field App visit logging write to tables the sync wipes — move them to the sheet
  too, or keep app-entered rows through the sync?
- Where FR visits (since 3/31) and outbound referrals (since 3/19) are logged now.
