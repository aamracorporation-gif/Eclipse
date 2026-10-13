# Recovery email

`recovery.html` is the Spanish Eclipse password recovery email.
It preserves the existing hosted recovery endpoint at
`https://api.weareeclipseoficial.com/auth/reset-password` with
`token_hash={{ .TokenHash }}&type=recovery`. Keep the TokenHash placeholder intact.

Subject: `Restablece tu contraseña · Eclipse`.

Applied through the Supabase dashboard to production project
`zurbdrfmwjqbrscairub` on 2026-10-09. Dashboard preview checked; no recovery email
was sent and no password was changed. Staging has not been updated.

The local template is referenced by `supabase/config.toml`; this file alone does
not update hosted Auth configuration.
