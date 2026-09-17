# Ad Studio: first usable release

## What this branch does

Visit `/ads` from the generation studio. Build a brief, load a brand template,
create three concepts per placement, edit every shot's visual direction, narration,
copy and timing, review the warnings, and export the storyboard as JSON. With a
configured account, save campaigns, reopen them, duplicate, approve or archive.
Approval never spends money or publishes an ad.

The planner uses deterministic templates, not a trained model or an LLM API.
Model suggestions use catalog capabilities, not live pricing or quality scores.
Short beats now request longer source clips for trimming. No automated trimming,
video assembly, second provider, or paid generation from storyboards is included.

Personal workspaces are owner-only. Shared teams, brand asset uploads, cloud media
history, usage budgets and a render queue remain future work. Brand templates
currently contain text rules and a color, not logos or fonts. Templates are saved
as new records; campaign plans snapshot their brief so later template changes
cannot alter an existing storyboard.

## Required deployment configuration

Use a dedicated Supabase project; no existing business database was modified.

1. Apply `supabase/migrations/20260917220803_ad_studio_workspace.sql` through your
   normal reviewed migration process. It creates only three prefixed tables,
   indexes, ownership policies and a revision trigger.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` before
   building the app. No Supabase service-role key is needed or accepted by the UI.
3. Set `APP_URL` to the app's canonical HTTPS origin. Configure the same Site URL
   in Supabase Auth and allow `APP_URL/auth/callback` as a redirect. Keep email
   confirmation enabled; configure email delivery and signup rate limits.
4. Generate `PROVIDER_ENCRYPTION_KEY` as 32 cryptographically random bytes encoded
   in hex. Store it only in server-side deployment secrets. Back it up securely;
   replacing it makes previously encrypted keys unreadable. Rotation currently
   requires users to remove and re-enter their provider credentials.
5. Set a verified HTTPS `HF_API_BASE_URL` and the existing
   `OPEN_HIGGSFIELD_READ_WRITE_TOKEN` for generation-media uploads.
6. Deploy, register two test accounts, confirm both emails, and execute the live
   checklist below before public access.

Without Supabase configuration, `/ads` shows a labeled preview. It does not save
to a fake database or silently use browser storage. Save buttons are disabled;
export JSON before leaving. Authenticated generation and uploads fail closed.

### Existing users

The generation studio remains at `/`. Users must now sign in at `/ads/login` and
re-enter provider keys. Old `api_key` cookies are cleared, not imported into an
arbitrary signed-in account. Generation payloads are no longer logged. Keys are
AES-256-GCM encrypted with account/provider-bound authenticated data before
database storage. The app never returns plaintext stored keys to the browser.

Uploads require a verified account, use account-prefixed random paths and have a
100 MB per-file cap. Media still uses public Vercel Blob URLs so providers can
read it. These are not private files; the upload picker warns users. Daily account
quotas, signed private media, lifecycle cleanup, and cloud generation history are
not yet implemented. The legacy gallery still uses browser-local IndexedDB, so
it is not an account-isolated media library on shared devices. Treat the workbench
as personal-device software until that migration is complete.

## Checks

```
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm test:smoke
```

Unit checks cover schemas, timing, short-shot routing, crop requirements, claim
warnings, provider request compatibility and encryption. PostgreSQL tests run the
actual migration in PGlite with two identities plus anonymous access; they verify
RLS, denied ownership reassignment and revision conflicts. HTTP smoke tests cover
preview rendering, uncached responses, legacy-cookie removal, unauthenticated
planning/upload denial, malformed uploads, and the existing studio entry point.

### Required live verification

- Register, confirm email, sign in, reload, refresh the session, and sign out.
- Account A saves a brand and campaign; verify reload restores both.
- Account B cannot read or change A's campaign, brand, or encrypted provider row.
- Edit the same campaign in two tabs; the stale tab must show a conflict.
- Save/replace/remove a provider key; verify only ciphertext is persisted.
- Upload a permitted file; reject an oversized file and unauthenticated upload.
- Run one explicitly approved provider generation and confirm polling still works.
- Check desktop and mobile storyboard editing in a hosted browser.

Live auth, email, media uploads and paid renders were not tested without a project
and deployment. The remote browser could not reach the local development server.

## References

- [Supabase SSR setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Next.js authentication](https://nextjs.org/docs/app/guides/authentication)

Deployment is also subject to resolving the upstream repository's missing
license. A README describing code as open source does not supply a license grant.
Do not assign a license to the inherited code without confirming those rights.
