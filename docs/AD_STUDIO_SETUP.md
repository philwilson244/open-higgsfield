# Ad Studio production setup

## Supabase

Use a dedicated project and apply every migration in `supabase/migrations` in
filename order. The migrations create owner-scoped application data, encrypted
provider accounts, shots, generation and render queues, campaign media, metrics,
budgets, quotas, retention records, and audit events.

Set these variables on the Railway web service:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `PROVIDER_ENCRYPTION_KEY` — 32 cryptographically random bytes encoded as hex
- `APP_URL` — canonical Railway HTTPS origin
- `HF_API_BASE_URL` — verified legacy-provider origin, only when used

Set these variables on the Railway worker service:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `PROVIDER_ENCRYPTION_KEY`
- provider-specific variables required by enabled adapters

The secret key and encryption key must never use a `NEXT_PUBLIC_` prefix. Back up
the encryption key securely; replacing it makes saved provider credentials
unreadable until users re-enter them.

Configure the Railway origin as the Supabase Auth Site URL and allow
`APP_URL/auth/callback`. Keep email confirmation enabled and configure production
email delivery.

## Railway services

Deploy two services from the same repository:

1. Web service using `Dockerfile` and its HTTP health check.
2. Background worker using `Dockerfile.worker` and `/health`.

The worker claims durable jobs, polls Runway and fal.ai, handles cancellation and retries,
renders Remotion MP4s, records actual costs, and periodically deletes expired
public uploads. If the worker is stopped, jobs remain durable but generation,
rendering, cancellation, and retention cleanup do not progress.

## Security and data handling

- Provider keys are AES-256-GCM encrypted at rest and never stored in cookies.
- Runway and fal.ai keys are saved per authenticated account from the Ad Studio
  provider panel; they are not Railway environment variables.
- Old `api_key` cookies are deleted and are not imported into a user account.
- Uploads are account-prefixed, randomly named, limited to 100 MB, and tracked
  with a default 30-day expiry. They use public URLs only while a provider needs
  to fetch them; the worker removes expired objects.
- Generated media uses signed access and campaign ownership checks.
- Database row-level security prevents cross-account access.
- Generation and rendering require campaign approval and available budget.
- Per-account windows and daily quotas limit upload bytes, generation attempts,
  renders, analytics imports, and estimated cost.
- Paid generation lifecycle and administrative campaign changes are appended to
  owner-visible audit events.

## Verification

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm test:smoke
pnpm test:e2e
```

For production browser tests, configure:

- `E2E_BASE_URL`
- `E2E_USER_EMAIL`
- `E2E_USER_PASSWORD`
- `E2E_RUN_PAID_GENERATION=1` only for an approved paid test

The test account must have a configured provider account and sufficient quota and
budget for the opt-in generation test.

Before public use, verify two accounts cannot access one another's brands,
campaigns, provider rows, jobs, media, quotas, or audits. Confirm a real upload is
recorded with an expiry, a paid generation can be canceled, reserved cost is
released correctly, rendered output is playable, and the audit event is visible.

## Commercial launch checklist

- Obtain trademark clearance for the public product and company branding.
- Review provider commercial terms and output-use rights.
- Establish privacy, retention, acceptable-use, copyright, and refund policies.
- Configure alerting for worker health, failure rates, provider health, quota
  pressure, cleanup failures, and unexpected daily spend.
- Keep the repository private unless a separate license decision is made.
