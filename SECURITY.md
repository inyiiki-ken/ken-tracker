# Security notes

## Secrets

Real credentials live **only** in `.env.local`, which is now git-ignored (see
`.gitignore`). Never paste real keys into `.env.example`, source files, or
commits. `.env.example` holds placeholders only.

Required secrets (all in `.env.local`):

- `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` — server reads/writes the sheet
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — Google sign-in
- `NEXTAUTH_SECRET` — encrypts session cookies
- `GOOGLE_SHEET_ID`, `NEXTAUTH_URL`

## Rotate the exposed keys (recommended)

The service-account private key, OAuth client secret, and `NEXTAUTH_SECRET`
were previously stored in a committed `.env.local`, so treat them as exposed
and rotate:

1. **Service-account key** — Google Cloud Console → IAM & Admin → Service
   Accounts → your account → Keys → *Add key* (new JSON), then delete the old
   key. Paste the new `private_key`/`client_email` into `.env.local`.
2. **OAuth client secret** — Console → APIs & Services → Credentials → your
   OAuth 2.0 Client → *Reset secret*. Update `GOOGLE_OAUTH_CLIENT_SECRET`.
3. **NEXTAUTH_SECRET** — regenerate with `openssl rand -base64 32` and update
   `.env.local`. (Rotating this signs everyone out — expected.)
4. Confirm the sheet is still shared as **Editor** with the service-account
   email, then restart the app.

## Access control

Google sign-in only proves identity. Who can see which tab (or is locked out)
is enforced by `config/roles.ts` + the `Roles` sheet + `AccessDenied.tsx`.
