create table if not exists router_nonce_store (
  nonce text primary key,
  ts bigint not null,
  updated_at timestamptz not null default now()
);
