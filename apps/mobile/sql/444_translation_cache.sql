-- 444 — the translate-once cache behind translate-v1 (LANGUAGE-LAYER slice 3)
--
-- One row per (target language, source text) pair, keyed by sha256 so the text itself
-- is not the primary key. Written ONLY by the edge function (service role); no client
-- role can read or write it — the function is the door, and its auth (user JWT or a
-- live confirmation token) is the policy.
--
-- Nothing here is a record of anything: rows are droppable at any time and the only
-- cost of dropping one is one repeated LLM call. Deliberately NOT per-user — the same
-- sentence translates the same way for everyone, and a per-user cache would multiply
-- cost by exactly the factor the cache exists to remove.

create table if not exists public.translation_cache (
  key        text primary key,          -- sha256(target || '\n' || source_text)
  target     text not null check (target in ('en','es')),
  body       text not null,
  created_at timestamptz not null default now()
);

alter table public.translation_cache enable row level security;
-- no policies on purpose: service-role bypasses RLS, every client role is refused.

revoke all on public.translation_cache from public, anon, authenticated;
