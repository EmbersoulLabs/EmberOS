# Railway credential rotation plan — 2026-10-21

Recorded: 2026-10-22. Names only. No secret values were read, stored, or rotated.

Live Railway variable names could not be listed because the Railway CLI session is invalid. Treat every secret that is actually present in Railway production or staging as pending rotation. Absence from this table is not evidence that a variable is safe.

Updating Railway does not revoke the original credential. Revoke the old value only after the web process and the worker process are both confirmed to be using the replacement. Do not revoke while Railway builds are paused: the running worker cannot pick up a replacement until redeploy is possible, and an early revoke takes production down.

Vercel holds the web app's copy of the database, Supabase, and Redis settings. A provider-side rotation invalidates the Vercel copy and the Railway copy together.

## Priority 0 — production data and infrastructure

| Name | Consumers | Issuer | Overlap | Verification | Revocation limit |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | Worker on Railway. Web on Vercel. | Supabase database password for the production project. | New password can be set while the old password still works only if Supabase allows two passwords. Confirm in the Supabase dashboard before cutover. Do not assume overlap. | Web `/api/health` reports database configured. Worker starts and completes a read-only `select 1` without printing the URL. | Revoking the old password disconnects every process still using it. No automatic rollback after revoke. |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker storage and web admin client. | Supabase API keys. | A new key can exist beside the old key until the old key is revoked. Confirm in the dashboard. | Authenticated storage read of an existing object, then stop. | Old key remains valid until revoked in Supabase. |
| `REDIS_URL` | Worker queues and web health queue counts. | The Redis provider configured in that URL. | Provider-specific. Confirm a second password or ACL user before cutover. | Health reports redis configured and queue counts load. Active and waiting counts stay interpretable. | Old URL keeps working until the provider revokes it. A bad cutover stalls renders and planning jobs. |

## Priority 0 — credentials that can spend money

| Name | Consumers | Issuer | Notes |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Worker startup and LLM calls. | OpenAI. | Create a new key, update consumers, then delete the old key. There is no evidence in this investigation that OpenAI already revoked it. |
| `AI_PROVIDER_OPENAI_API_KEY` | Typed provider config. | OpenAI. | Rotate even if it duplicates `OPENAI_API_KEY`. |
| `SEEDANCE_API_KEY` | Seedance video adapter. | BytePlus / Seedance. | Do not send a generation to test the new key. |
| `AI_PROVIDER_SEEDANCE_API_KEY` | Typed provider config. | BytePlus / Seedance. | Same cutover rule. |
| `AI_PROVIDER_MINIMAX_API_KEY` | MiniMax config. | MiniMax. | Same cutover rule. |
| `AI_PROVIDER_FAL_API_KEY` | Fal config. | Fal. | Same cutover rule. |
| `PHOTOROOM_API_KEY` | Photo Scene background removal. | Photoroom. | Same cutover rule. |

## Priority 1 — lower impact, still in the Railway roll instruction

| Name | Why it is included |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public by design and enforced with RLS, but Railway said to roll every stored variable. |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL, not a secret. Included so the cutover record is complete. |
| `JAMENDO_CLIENT_ID` | Optional music search. Rotate if it is present. |
| `SUPABASE_STORAGE_BUCKET` | Bucket name, not a secret. |

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` appear only as empty architecture placeholders. No runtime reader was found. If either name exists in Railway, rotate it at Stripe. Otherwise Stripe is out of scope.

GitHub repository secrets currently list only `PRODUCTION_APP_URL`. Workflow files reference `DATABASE_URL`, `REDIS_URL`, and `OPENAI_API_KEY`, but those names are not present in the repository secret list. No GitHub token or registry credential was found stored as a repository secret.

## Cutover order

1. Sign in to Railway again. List variable names for production and staging. Do not copy values into chat, Git, or these documents.
2. At each issuer, create the replacement. Leave the old credential valid.
3. Stage the replacement in Vercel for the production web target.
4. Stage the replacement in Railway with deploy skipping if the CLI offers it. Do not expect the running worker to adopt it while builds are paused.
5. When Railway says builds for this workspace are available, redeploy only the existing production worker commit. Confirm the process start time is after the variable change.
6. Confirm web health and a worker read-only database check.
7. Revoke the old credential at the issuer.
8. Seal the Railway production variables after rotation so they cannot be read back.

No replacement was generated in this response. Generating a database password or provider key and leaving it unused, or installing it while deploys are paused, does not improve containment.
