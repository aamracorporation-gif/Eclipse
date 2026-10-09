# Recovery email

`recovery.html` is the Spanish Eclipse password recovery email. Keep
`{{ .ConfirmationURL }}` intact: Supabase supplies the single-use recovery link.
The template intentionally does not hardcode a token lifetime or change redirects.

The local template is referenced by `supabase/config.toml`. This does **not** update
a hosted project's Auth configuration. For the hosted project, apply this HTML in
Authentication → Email templates → Reset password, with the subject:

`Restablece tu contraseña · Eclipse`

Status: prepared in source control; not applied to hosted Auth. Verify the rendered
email and recovery flow on a test account after applying the template. Do not send
recovery emails to customers as a deployment test.
