create table if not exists router_nodes (
  node_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists router_payment_requests (
  request_key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists router_payment_receipts (
  receipt_key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists router_manifests (
  manifest_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists router_manifest_admissions (
  node_id text primary key,
  eligible boolean not null,
  reason text,
  updated_at timestamptz not null default now()
);
