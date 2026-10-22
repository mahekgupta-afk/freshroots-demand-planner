-- Freshroots demand planner: schema (spec section 5) + RLS

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
  decided_by uuid references auth.users(id),
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

create table profiles (
  id uuid primary key references auth.users(id),
  full_name text,
  role text not null check (role in ('planner','procurement','admin'))
);

-- Row-level security -------------------------------------------------------
-- The service role bypasses RLS, so server-only tables simply get no write policy.
alter table skus enable row level security;
alter table weekly_sales enable row level security;
alter table stock_snapshots enable row level security;
alter table open_pos enable row level security;
alter table runs enable row level security;
alter table recommendations enable row level security;
alter table ai_calls enable row level security;
alter table profiles enable row level security;

create policy "authenticated read" on skus for select to authenticated using (true);
create policy "authenticated read" on weekly_sales for select to authenticated using (true);
create policy "authenticated read" on stock_snapshots for select to authenticated using (true);
create policy "authenticated read" on open_pos for select to authenticated using (true);
create policy "authenticated read" on runs for select to authenticated using (true);
create policy "authenticated read" on recommendations for select to authenticated using (true);
create policy "authenticated read" on ai_calls for select to authenticated using (true);
create policy "read own profile" on profiles for select to authenticated using (id = auth.uid());

create or replace function public.current_role_name() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

create policy "planner/admin can decide" on recommendations for update to authenticated
  using (public.current_role_name() in ('planner','admin'))
  with check (public.current_role_name() in ('planner','admin'));

-- Column-level guard: planners may only touch review fields, never the rule output.
revoke update on recommendations from authenticated;
grant update (review_state, final_qty, decided_by, decided_at, override_reason)
  on recommendations to authenticated;
