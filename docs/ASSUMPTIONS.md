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
| 8 | Planners can update only the review columns of `recommendations` (column-level grant). Rule output stays read-only to users. | migration 0001 |
| 9 | Open POs count toward effective stock (spec 6.5). One flag in `rules.json` reverses it. | `rules.json` |
| 10 | The SAP freshness check uses the file's last-modified time in Storage. | `ingest/sap.ts` |

## Environment note
`npm install` of dev dependencies failed with an npm arborist error on this machine. `--legacy-peer-deps` fixed it.
