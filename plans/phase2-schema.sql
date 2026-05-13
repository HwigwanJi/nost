-- nost Phase 2 sync schema
--
-- Run in: Supabase dashboard → SQL Editor → "New query" → paste → Run.
-- Idempotent: re-running on top of an existing install is safe
-- (CREATE TABLE IF NOT EXISTS / CREATE POLICY IF NOT EXISTS).
--
-- This is the minimal MVP. Decisions live in plans/sync-and-auth.md §2.2.
-- After running this, verify in Table Editor:
--   - devices, app_data_snapshots, memos rows exist (empty)
--   - "Authentication → Policies" shows the 3 RLS policies per table
--
-- Why one big snapshot row vs per-card rows: simpler conflict model for
-- Phase 2. Per-card LWW (with row-per-card) is a Phase 3 upgrade path.
-- Memos get their own table because (a) bodies can be 10s of KB and
-- (b) full-text search later wants its own table to index.

------------------------------------------------------------------------
-- devices: which PCs has this user signed in from
------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  hostname        text,
  platform        text,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS devices_user_idx ON public.devices(user_id);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "device-owner-select" ON public.devices
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "device-owner-insert" ON public.devices
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "device-owner-update" ON public.devices
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "device-owner-delete" ON public.devices
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

------------------------------------------------------------------------
-- app_data_snapshots: the synced subset of AppData (Cohort A + structure)
--
-- Client-side filter (`lib/cohort.ts:partitionByCohort`) drops Cohort C
-- items BEFORE this row is written. So `data` here contains only what
-- makes sense across devices.
--
-- `generation` is the LWW conflict counter — each successful write bumps
-- it. The client passes the generation it last saw on update; if the
-- server's is higher, the client pulls and merges first.
------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_data_snapshots (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data               jsonb NOT NULL,
  generation         bigint NOT NULL DEFAULT 1,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by_device  uuid REFERENCES public.devices(id) ON DELETE SET NULL
);

ALTER TABLE public.app_data_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "snapshot-owner-select" ON public.app_data_snapshots
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "snapshot-owner-insert" ON public.app_data_snapshots
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "snapshot-owner-update" ON public.app_data_snapshots
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

------------------------------------------------------------------------
-- memos: bodies live here so the snapshot row stays small + indexable
------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.memos (
  id                 text NOT NULL,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body               text NOT NULL,
  generation         bigint NOT NULL DEFAULT 1,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by_device  uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  expires_at         timestamptz,
  trashed_at         timestamptz,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS memos_user_idx ON public.memos(user_id);

ALTER TABLE public.memos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "memo-owner-select" ON public.memos
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "memo-owner-insert" ON public.memos
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "memo-owner-update" ON public.memos
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "memo-owner-delete" ON public.memos
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

------------------------------------------------------------------------
-- Realtime publication: enable change-streaming for snapshot + memos
-- so other devices get push updates instead of polling.
------------------------------------------------------------------------

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.app_data_snapshots;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.memos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
