# Freshroots Demand Planner

Internal demand-planning tool. Rules decide quantities, Gemini only explains odd SKUs, a human approves before anything reaches Zoho. Full brief: the build spec.

## Status
Phase 1 (foundation): rules engine, rules schema, SAP CSV ingest and validation, Supabase migration. Done and tested.
Next: pipeline (cron, run logging, dashboard), then Zoho, Gemini, review queue.

## Commands
```
npm install --legacy-peer-deps
npm test
npm run typecheck
```

## Rules
`config/rules.json`. Change a threshold with a pull request; Raghav must review.
