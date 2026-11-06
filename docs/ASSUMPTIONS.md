# Assumptions

Where the build spec was ambiguous, the most conservative option was taken. Confirm each with Raghav.

| # | Assumption | Where |
|---|---|---|
| 1 | Cover exactly equal to the min or max is `on_track`. Stockout is strictly below min, overstock strictly above max. | `engine.ts`, tested |
| 2 | High demand is strictly greater than 1.2x the 12-week average, using raw (not uplifted) sales. | `engine.ts` |
| 3 | A SKU with zero demand and stock on hand is `overstock` (pause). Zero demand and zero stock is `on_track` (no action). | `engine.ts` |
| 4 | Coefficient of variation uses the population standard deviation over the weeks available. | `engine.ts` |
| 5 | The sudden-drop test compares week 12 with the mean of weeks 9-11 and is skipped if that mean is 0. | `engine.ts` |
| 6 | `needs_review` SKUs keep the rule result in `rule_status` and `recommended_qty` as reference only. | `engine.ts` |
| 7 | **Schema change from the spec:** `open_pos` is keyed on `(zoho_po_id, sku_id)`, not `zoho_po_id` alone, because one PO can hold several SKUs. | migration 0001 |
| 8 | **Database is Neon Postgres, not Supabase** (client's choice). No row-level security: only server code holds `DATABASE_URL`, and role checks (planner/procurement/admin) are enforced in the app. Login and the SAP file drop (Supabase Auth/Storage in the spec) are replaced separately. | migration 0001 |
| 9 | Open POs count toward effective stock (spec 6.5). One flag in `rules.json` reverses it. | `rules.json` |
| 10 | The SAP freshness check uses the file's last-modified time in Storage. | `ingest/sap.ts` |

## Environment note
`npm install` of dev dependencies failed with an npm arborist error on this machine. `--legacy-peer-deps` fixed it.

## Real SAP sample files (data/sample)
11. The real export differs from the spec's column names. Ingest reads the real headers (`SKU_ID, SKU_Name, Perishability, Standard_Reorder_Qty`, etc.).
12. `Perishability = High` means perishable; `Low` means not. No other values are accepted.
13. Weeks arrive as ISO labels (`2026-W42`) and are stored as the Monday date.
14. The export has no `first_sale_date` or `active` flag. All SKUs are treated as active, and new-launch detection relies on weeks of sales history only.
15. `Distributor_ID` and category are in the master file but unused in v1 (per-distributor logic is out of scope).
16. The stock file has a location column. Stock is summed across locations per SKU.
17. The sample sales history is 16 weeks (W27-W42). The engine uses the latest 12.
18. `festival_calendar.csv` agrees with `rules.json` (Mar, Oct, Nov). Rules.json stays the source of truth.

## Gemini triage
19. Gemini runs only for SKUs routed to review. It writes a note (max 60 words), a suggested action and a confidence. It can never change a quantity: quantities are set by the rules and stored separately. This is also covered by a test.
20. SKUs are sent in batches of 8, up to 6 batches in parallel. `ai_calls` therefore gets **one row per API call** (a batch), not per SKU; the SKU ids are in `request->'skus'`. Failed calls are logged too, with the error.
21. A call that fails or returns invalid output is retried once, after a 3 second pause (new models often return brief "high demand" errors). SKUs still without a note are saved with `gemini_failed = true` and the review screen says the AI note is unavailable.
22. The whole AI step has a 35 second budget so a run always finishes inside Vercel's 60 second limit. When the budget runs out the remaining SKUs are flagged as unavailable. Revisit this if review volume grows past roughly 80 SKUs per run.
23. If `GEMINI_API_KEY` or `GEMINI_MODEL` is missing, triage is skipped and the run still completes. The reason is stored in the run summary (`summary.ai.skipped_reason`).
24. **Model choice:** `GEMINI_MODEL=gemini-3.5-flash`. `gemini-2.5-flash` is closed to new accounts (404), `gemini-3.8-flash` was unreliable when tested (503s and timeouts), and the `-latest` aliases timed out. Pin a named version rather than an alias so behaviour does not change silently. Re-test with `npm run triage-smoke` before changing it.
25. Only these fields reach Gemini: SKU id, name, perishable flag, 12 weekly sales, stock, open PO quantity, the rule result and suggested quantity, the review reasons and the planning month. No distributor or personal data.

## Email notifications
26. Run summaries (date, counts by status, SKUs waiting for review, most urgent SKUs, link to the review queue) are emailed after each **scheduled** run only. A manual "Run now" does not email, because the person who clicked is already looking at the screen.
27. **Failed runs always alert**, scheduled or manual. They go to `ALERT_EMAILS` (admin and IT lead). If that is empty they go to `NOTIFY_EMAILS`, so a failure is never silent.
28. Email is best-effort and happens after the run is saved. A broken email, a missing key or an unverified sender never fails or delays a run. The outcome is stored in the run summary (`summary.notify`).
29. Product names come from SAP and are HTML-escaped in emails.
30. Sending uses Resend over HTTPS. The sender (`NOTIFY_FROM`) must be on a domain verified in Resend. Until one is verified, Resend only delivers to the account owner's own address (`onboarding@resend.dev` as sender is fine for testing).
31. The dashboard shows a red banner when the latest run failed or has been "running" for over 10 minutes, so a failure is visible even if the email is not set up.

## Data freshness, procurement list, history
32. Stock older than 2 days (India calendar days) shows an amber banner on the dashboard, recommendations and procurement pages. With `REQUIRE_FRESH_DATA=true` the run itself fails (and alerts) instead. It defaults to off only because the pilot runs on sample data with no live SAP feed. **Turn it on when the SAP export goes live.** The age is stored in each run summary as `stock_age_days`.
33. The procurement list shows only SKUs whose quantity is settled: rule-decided ones, and ones a planner approved or overrode (the planner's final quantity wins). SKUs waiting for review are held back and counted. On-track SKUs are omitted. Without Zoho, procurement acts from this list or its CSV; there are no draft purchase orders.
34. CSV exports prefix any text starting with `=`, `+`, `-` or `@` with an apostrophe, so a product name from SAP cannot run as a spreadsheet formula.
35. The Runs page is for planners and admins. SKU detail and the procurement list are visible to every signed-in user.

## Login switch
36. Login can be turned off with `AUTH_DISABLED=true` (set in Vercel). Every visitor then acts as an anonymous admin called "Guest": they can see all data, approve or override review items, and start runs. Decisions are recorded against a "Guest" profile, so the audit trail shows they were made without a login but cannot say by whom. Unset the variable to bring login back; no code change is needed.
37. The cron route is not affected by the switch. It keeps its own `CRON_SECRET`.
38. "Run now" has a 2 minute cooldown (any user, login on or off), so an open site cannot be used to trigger unlimited runs.
