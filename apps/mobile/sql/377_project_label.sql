-- Project color label — REQ-PM14. A single user-applied color label per project,
-- to organise the list. Mutable relational field → lives on the project row (PowerSync
-- syncs it both ways, per the stack split). One label (companycam's primary pattern;
-- simplest for the ICP — see AUTONOMOUS-BUILD-LOG DEC-3); many-labels is a follow-up.
--
-- Value is a color KEY ('red','amber','green','blue','purple','slate') or NULL for
-- none. Not a check constraint: the client owns the palette and an unknown value must
-- degrade to "no color", never reject the write (a label is never worth a lost sync).
alter table public.project add column if not exists label text;
