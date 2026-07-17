-- Media objects: create-only, owner-scoped, immutable.
--
-- Object keys are content-addressed (<owner>/<capture>/<sha256>), so an object
-- can only be written once and its name proves its bytes. No UPDATE and no
-- DELETE grant: media is evidence (L1 immutable). Lawful erasure is a separate,
-- privileged path (DECISION 4 -> hard-delete + retained hash stub), never the
-- client.
drop policy if exists captures_insert_own on storage.objects;
drop policy if exists captures_read_own on storage.objects;

create policy captures_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy captures_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
