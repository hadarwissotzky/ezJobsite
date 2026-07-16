-- Scope the powersync publication to ONLY the bakeoff tables.
-- The PowerSync+Supabase guide cautions that `FOR ALL TABLES` "can cause memory
-- spikes with large data volumes — restrict to specific tables if needed".
-- FOR ALL TABLES was also replicating auth.users, storage.objects and every
-- internal Supabase table into the sync pipeline, which we neither need nor want.
-- Safe to recreate: no replication slot exists yet (PowerSync not yet connected).
drop publication if exists powersync;
create publication powersync for table
  public.project,
  public.capture,
  public.capture_op_state,
  public.attachment;
