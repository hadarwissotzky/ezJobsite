-- Create two confirmed test users directly. The signup API is rate-limited on
-- confirmation emails and rejects .test TLDs; for a throwaway spike, inserting
-- confirmed users is deterministic and avoids the mail path entirely.
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  uid uuid;
  u   text;
  pw  text := 'bakeoff-spike-pw-2026';
begin
  foreach u in array array['device1@example.com','device2@example.com'] loop
    delete from auth.identities where identity_data->>'email' = u;
    delete from auth.users where email = u;
    uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      u, extensions.crypt(pw, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false
    );

    -- Supabase requires a matching identity row for password grant to work.
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), uid,
      jsonb_build_object('sub', uid::text, 'email', u, 'email_verified', true),
      'email', uid::text, now(), now(), now()
    );
  end loop;
end $$;
