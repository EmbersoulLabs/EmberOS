# Railway production recovery — 2026-10-21

Recorded: 2026-10-22.

## Current state

Railway deployment is paused. The 2026-10-22 00:22 UTC status update said builds were still being restored. This response did not retry a deploy.

The production web deployment is serving release `a5db8692a80f141cf14c71907441f6ae580e7d5a` and its health check reports the database, Supabase, and Redis as configured. That shows the existing web process is up. It does not show that its credentials are unexposed, and it does not show that the Railway worker has been restarted onto new credentials.

The local Railway session cannot list services, logs, or variable names until `railway login` succeeds. Railway invalidated OAuth sessions as part of the incident response, which matches this failure.

## What was not done

- No production variable was changed.
- No credential was revoked.
- No database was modified.
- No production worker was restarted.
- No pull request was merged.
- No paid provider call was made.
- The ongoing end-to-end worktrees were not changed.

## Recovery sequence after human authorization

1. `railway login` with the workspace account.
2. Confirm the active production worker is `emberos-worker-production` and record its deployment id and commit. Do not deploy `@ceo-agent/worker`.
3. Complete the rotation plan in `railway-credential-rotation-plan.md`.
4. Wait until Railway's status page says builds are enabled for this workspace. One failed deploy attempt is enough to know they are still paused. Do not retry.
5. Redeploy the already-running production worker commit only, after the replacement variables are staged. Do not ship this documentation branch as a production deploy.
6. Smoke-check the deployed web SHA, health configuration flags, an authorized read, and queue connectivity. Do not start video generation.

## Remaining blockers

- Railway CLI authorization is unavailable.
- Live Railway variable inventory is unread.
- Provider and database audit logs were not available.
- Builds are paused, so a staged replacement cannot be adopted by the worker.
- Old credentials must stay in place until that cutover exists. They remain potentially compromised.

## Next action

A person with Railway workspace access signs in, lists production and staging variable names, and creates replacement credentials at Supabase, Redis, and the AI providers without revoking the current values.
