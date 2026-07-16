-- GoTrue scans several auth.users token columns into non-nullable Go strings.
-- NULL there produces "Database error querying schema" on the password grant.
-- Empty string is what the real signup path writes.
update auth.users
set confirmation_token       = coalesce(confirmation_token, ''),
    recovery_token           = coalesce(recovery_token, ''),
    email_change             = coalesce(email_change, ''),
    email_change_token_new   = coalesce(email_change_token_new, ''),
    email_change_token_current = coalesce(email_change_token_current, ''),
    phone_change             = coalesce(phone_change, ''),
    phone_change_token       = coalesce(phone_change_token, ''),
    reauthentication_token   = coalesce(reauthentication_token, '')
where email in ('device1@example.com','device2@example.com');
