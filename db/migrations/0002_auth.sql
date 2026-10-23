-- Login support: password hashes, account switch, and brute-force lockout.
alter table profiles add column password_hash text;
alter table profiles add column active boolean not null default true;
alter table profiles add column failed_attempts integer not null default 0;
alter table profiles add column locked_until timestamptz;
alter table profiles add column created_at timestamptz not null default now();
create unique index profiles_email_lower_idx on profiles (lower(email))
