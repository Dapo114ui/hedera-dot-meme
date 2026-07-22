-- Run this once in the Supabase SQL editor to enable the treasury
-- auto-buy feature (api/treasury-buy.js). It logs one row per token the
-- treasury has bought into, and doubles as an idempotency guard so the
-- same token is never bought twice.

create table if not exists treasury_buys (
    id bigint generated always as identity primary key,
    token_id text not null unique,
    hbar_spent_tinybars bigint not null,
    tokens_received numeric not null,
    tx_id text,
    created_at timestamptz not null default now()
);

alter table treasury_buys enable row level security;

create policy "treasury_buys_insert" on treasury_buys
    for insert to anon with check (true);

create policy "treasury_buys_select" on treasury_buys
    for select to anon using (true);
