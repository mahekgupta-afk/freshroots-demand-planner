# Freshroots Demand Planner

Internal demand-planning tool. Rules decide quantities, Gemini only explains odd SKUs, a human approves before anything reaches Zoho. Full brief: the build spec.

## Status
Phase 1 (foundation) and Phase 2 (app skeleton) are in. The dashboard and recommendations table run on the sample SAP files until Supabase is connected. The cron route is built but untested against a live database.
Next: Supabase auth and seed, Zoho read-only sync, Gemini triage, review queue.

## Commands
```
npm install --legacy-peer-deps
npm run dev   # http://localhost:3000
npm test
npm run typecheck
```

## Rules
`config/rules.json`. Change a threshold with a pull request; Raghav must review.
