-- Habitat sync hub — run once in the Supabase SQL editor.
--
-- WHAT THIS IS NOT
--
-- It is deliberately not a mirror of the local SQLite schema. Twelve tables
-- with every column spelled out would mean a Postgres migration for every
-- column Habitat adds locally, and — worse — a phone running last month's build
-- would push rows the server rejects. Habitat's local schema changes often
-- enough (see `ensureColumn` in electron/db.js) that this would be a permanent
-- tax and a permanent source of version skew.
--
-- So the hub stores rows as JSON, keyed by which table they came from. It never
-- reads inside them. Sync only ever asks one question — "what has changed since
-- I last looked?" — and answering that needs no knowledge of what a card or a
-- canvas edge is.
--
-- The cost, stated plainly: nothing here can be queried or reported on
-- server-side, and Postgres validates none of it. If a web client ever needs to
-- ask real questions of this data, it wants views over `data` (or a real
-- schema) added alongside — not this table replaced.

-- ---------------------------------------------------------------- change feed

-- The pull cursor. A timestamp is the obvious choice and the wrong one: `now()`
-- is transaction-start time in Postgres, so two writes can share one, and a
-- client asking for "> that moment" would step over the second. A sequence is
-- monotonic and needs no clock agreement between a laptop and a phone.
create sequence if not exists habitat_seq;

create table if not exists habitat_rows (
  user_id uuid    not null references auth.users (id) on delete cascade,
  tbl     text    not null,
  row_id  text    not null,
  -- The row as the client had it. Null when this is a tombstone: the id has to
  -- stay on record, or a delete made on one device is merely a row the other
  -- device is missing, and the next pull puts it back.
  data    jsonb,
  deleted boolean not null default false,
  seq     bigint  not null default nextval('habitat_seq'),
  at      timestamptz not null default now(),
  primary key (user_id, tbl, row_id)
);

-- Every pull is "my rows, in order, after this point", and that is the only
-- read pattern there is.
create index if not exists habitat_rows_feed on habitat_rows (user_id, seq);

-- A row that changes takes a new place at the end of the feed. Without this an
-- update would keep its original seq and every device that had already read
-- past it would never see the change.
create or replace function habitat_bump() returns trigger
language plpgsql as $$
begin
  new.seq := nextval('habitat_seq');
  new.at  := now();
  return new;
end $$;

drop trigger if exists habitat_rows_bump on habitat_rows;
create trigger habitat_rows_bump
  before insert or update on habitat_rows
  for each row execute function habitat_bump();

-- ------------------------------------------------------------------ isolation

-- The publishable key ships inside the app, so it is public by definition and
-- everything rests on this: a signed-in user reaches their own rows and no one
-- else's. `with check` matters as much as `using` — without it a client could
-- write rows stamped with somebody else's user_id.
alter table habitat_rows enable row level security;

drop policy if exists habitat_rows_own on habitat_rows;
create policy habitat_rows_own on habitat_rows
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -------------------------------------------------------------------- blobs

-- Attachments are already addressed by the SHA-256 of their bytes locally, so
-- the same name works here: uploading a file twice is uploading it once, and a
-- device that already has the hash never asks for it again.
insert into storage.buckets (id, name, public)
values ('habitat-files', 'habitat-files', false)
on conflict (id) do nothing;

-- Files live under a folder named for the owner: habitat-files/<user id>/<hash>.
--
-- The check is on that folder rather than on storage.objects.owner, which looks
-- like the obvious column and is the wrong one: `owner` is filled in by the
-- storage layer as part of the insert, so a `with check` that reads it can be
-- evaluating a row whose owner is still null and refuse a perfectly good
-- upload. The path is known before the write and says the same thing.
drop policy if exists habitat_files_own on storage.objects;
create policy habitat_files_own on storage.objects
  for all
  using (bucket_id = 'habitat-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'habitat-files' and (storage.foldername(name))[1] = auth.uid()::text);
