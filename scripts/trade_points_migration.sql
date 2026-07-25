-- Run this once in the Supabase SQL editor to enable trade-volume points
-- (api/award-points.js). One row per verified trade; tx_id is unique so
-- the same trade can never be counted twice.
--
-- IMPORTANT: unlike treasury_buys, this table does NOT grant the anon
-- role insert access. Points map to a real future token airdrop, so
-- writes only happen server-side (api/award-points.js, using the
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS) after the server
-- independently verifies the trade against Hedera's mirror node - never
-- trusting a client-supplied volume or points figure. If the anon key
-- (public, embedded in the browser bundle) could insert directly, anyone
-- could award themselves arbitrary points.

create table if not exists trade_points_ledger (
    id bigint generated always as identity primary key,
    wallet_address text not null,
    token_address text not null,
    tx_id text not null unique,
    volume_tinybars bigint not null,
    points_awarded integer not null,
    created_at timestamptz not null default now()
);

create index if not exists trade_points_ledger_wallet_idx on trade_points_ledger (wallet_address);
create index if not exists trade_points_ledger_wallet_created_idx on trade_points_ledger (wallet_address, created_at);

alter table trade_points_ledger enable row level security;

-- Public read only (for a future points leaderboard). No insert/update/
-- delete policy for anon - all writes go through the service role key.
create policy "trade_points_ledger_select" on trade_points_ledger
    for select to anon using (true);
