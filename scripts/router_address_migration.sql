-- Run this once in the Supabase SQL editor to let the frontend know which
-- bonding-curve contract a given token lives on. Every token launched
-- before this migration lives on the third-party memejob contract; the
-- new first-party OnycBondingCurve contract only handles tokens launched
-- after the frontend is wired up to use it (a separate, not-yet-done
-- phase - see router-registry.js).
--
-- The column default AND the backfill below both point at memejob, so
-- router_address is always populated (never NULL) for every row, old or
-- new, even before any frontend code is updated to set it explicitly.

alter table meme_tokens add column if not exists router_address text;

update meme_tokens
set router_address = '0xa3bf9adec2fb49fb65c8948aed71c6bf1c4d61c8'
where router_address is null;

alter table meme_tokens alter column router_address set default '0xa3bf9adec2fb49fb65c8948aed71c6bf1c4d61c8';
alter table meme_tokens alter column router_address set not null;
