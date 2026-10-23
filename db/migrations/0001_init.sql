-- Freshroots demand planner: schema (spec section 5), plain Postgres (Neon).
-- Access control is enforced in the app, not in the database: only server code holds DATABASE_URL.

create table profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  role text not null check (role in ('planner','procurement','admin'))
);

create table skus (
  sku_id text primary key,
  name text not null,
  perishable boolean not null default false,
  std_qty integer not null check (std_qty >= 0),
  first_sale_date date,
  active boolean not null default true
);

create table weekly_sales (
  sku_id text references skus(sku_id),
  week_start date not null,
  qty numeric not null check (qty >= 0),
  primary key (sku_id, week_start)
);

create table stock_snapshots (
  sku_id text references skus(sku_id),
  snapshot_date date not null,
  on_hand numeric not null check (on_hand >= 0),
  primary key (sku_id, snapshot_date)
);

create table open_pos (
  zoho_po_id text not null,
  sku_id text references skus(sku_id),
  qty numeric not null,
  expected_date date,
  status text,
  synced_at timestamptz default now(),
  -- one PO can contain several SKUs, so the key is the pair
  primary key (zoho_po_id, sku_id)
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  finished_at timestamptz,
  planning_month int not null check (planning_month between 1 and 12),
  rules_version text not null,
  trigger text not null check (trigger in ('cron','manual')),
  status text not null default 'running' check (status in ('running','done','failed')),
  summary jsonb,
  error text
);

create type rec_status as enum ('stockout','overstock','high_demand','on_track','needs_review');
create type review_state as enum ('auto','pending','approved','overridden');

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references runs(id) on delete cascade,
  sku_id text references skus(sku_id),
  status rec_status not null,
  rule_status rec_status not null,
  avg_12wk numeric,
  last_4wk_avg numeric,
  weekly_demand numeric,
  effective_stock numeric,
  cover_weeks numeric,
  recommended_qty integer,
  reasons text[],
  review_reasons text[],
  gemini_note text,
  gemini_action text,
  gemini_confidence text,
  review_state review_state not null default 'auto',
  final_qty integer,
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  override_reason text,
  zoho_draft_po_id text,
  created_at timestamptz default now(),
  constraint override_needs_reason
    check (review_state <> 'overridden' or (override_reason is not null and length(trim(override_reason)) > 0))
);
create index recommendations_run_idx on recommendations(run_id);
create index recommendations_sku_idx on recommendations(sku_id);

create table ai_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references runs(id),
  sku_id text,
  model text,
  request jsonb,
  response jsonb,
  latency_ms integer,
  error text,
  created_at timestamptz default now()
);
