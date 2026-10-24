# Railway security incident — 2026-10-21

Recorded: 2026-10-22. This report contains names and metadata only. It does not contain secret values.

## Confirmed facts

Source: [Railway security disclosure](https://blog.railway.com/p/security-disclosure-wednesday-october-21st), published 2026-10-21 by Jacob Cooper, and [incident QH8L8B3E](https://status.railway.com/incident/QH8L8B3E), last read 2026-10-22.

- On the morning of 2026-10-21, Railway detected anomalous activity on systems that store customer environment variables.
- Railway's investigation to that point said an unauthorized party may have accessed encrypted environment variables and obtained decrypted contents for some of them.
- Railway said the impact may be limited to a subset of users, and that affected accounts would be contacted by email. EmberOS has not received a customer-specific confirmation in this investigation.
- Railway recommended that every customer immediately roll all environment variables stored in Railway, including API keys and private registry credentials, and review service logs.
- Railway said it notified upstream AI inference providers to revoke keys proactively. This investigation did not confirm that any EmberOS key was revoked by a provider.
- Builds and deployments were paused platform-wide, including Enterprise. Re-enablement was planned in stages: Enterprise, Pro, Hobby, then Free and Trial.
- Railway invalidated OAuth sessions. Users may need to sign in again.
- Railway is rotating its own storage-bucket credentials. Activity by Railway employee Faraz Patankar for that rotation is expected. EmberOS application storage is Supabase. This investigation did not confirm that the EmberOS Railway project uses Railway buckets.
- As of the 2026-10-22 00:22 UTC status update, Railway was still working to make builds available and said remediation guides would follow. The 2026-10-21 22:45 UTC update still said builds remain paused. Deployment availability does not prove that stored credentials are safe.

## Reasonable risks

- Any secret that was stored in the EmberOS Railway project during the exposure window is potentially compromised until it is rotated at the issuing provider and the old value is revoked.
- Updating a Railway variable does not revoke the original credential.
- A running worker does not adopt a new variable until that process is restarted or redeployed. Railway has said redeploys cannot pick up new credentials while builds are paused.
- The same secret values may also be configured on Vercel for the web app. Rotating the provider credential invalidates both copies.

## Unknowns

- Whether the EmberOS Railway project is in the affected subset.
- The exact start and end of the exposure window. Railway described it as earlier on 2026-10-21 and has not published a closed interval.
- The live list of Railway variable names. The local Railway CLI session is no longer valid (`railway login` is required). Variable values were not read.
- Supabase, Redis, OpenAI, Seedance, MiniMax, Fal, and Photoroom audit logs for the window.
- Whether Railway bucket revocation applies to this project.

## Production services

Previously identified Railway project `comfortable-serenity` (`b2004ec8-7747-4fae-bca4-4167a3385d49`):

| Service | Environment | Service id | Environment id | This session |
| --- | --- | --- | --- | --- |
| `emberos-worker-production` | production | `d134983f-9ca8-4638-bab7-e98a28dfe526` | `2a11afdc-4f05-46cf-a9fd-893982a5a34e` | Not re-queried. CLI unauthorized. |
| `emberos-worker-staging` | staging | `3dc12fab-561e-4ab6-96d2-19535a2c4654` | `de092159-8b57-4729-a8ef-1b4ac0c2b33f` | Not re-queried. CLI unauthorized. |

Unused service `@ceo-agent/worker` (`543a02ac-11ff-47ed-b01e-62d2f832c361`) must not be deployed.

The web app is on Vercel, not Railway. At 2026-10-22 01:02 UTC, `GET /api/health` on the production web alias returned HTTP 200, release revision `a5db8692a80f141cf14c71907441f6ae580e7d5a`, and reported Supabase, database, and Redis as configured. Queue counts were render waiting 0, active 0, failed 42, agent waiting 0, active 0. Those failed jobs have no timestamps here and are not attributed to this incident. Health does not identify which project or which credential version is in use.

`a5db8692a80f141cf14c71907441f6ae580e7d5a` is the GitHub merge of pull request 285, authored by the `EmbersoulLabs` account at 2026-10-21 11:00:52 UTC. That is inside the incident day and is an expected repository merge, not an unknown account.

## Suspicious activity

| Source | Result |
| --- | --- |
| Railway deployment and service logs | UNKNOWN. CLI unauthorized. |
| Supabase database and admin events | UNKNOWN. No audit export was available. |
| AI provider usage and spend | UNKNOWN. No provider audit was available. |
| Redis connections | UNKNOWN. |
| Stripe | No runtime Stripe client was found. Presence of a Stripe secret inside Railway is UNKNOWN. |
| GitHub | Reviewed. Repository secret list contains only `PRODUCTION_APP_URL`. The incident-day commit found on the production web revision is the organization merge of pull request 285. No unknown committer was identified in that check. |
| Production web health | Existing deployment responded. This does not prove credential safety. |

Tracked-file scan of this worktree (1,693 files) found 19 pattern matches. All were localhost CI database URLs, example placeholders, or tests that assert credential redaction. No production credential was found in Git.

## Safe code change

`logQueueConfig` logged the raw `REDIS_URL` when the value could not be parsed. The security branch returns `unparsed` instead. This does not rotate credentials and does not change production.

## Deployment

Railway builds were still paused at the last explicit status statement, and the later update said builds were not yet available. No deploy was attempted. Production was not modified by this response. No database statement was executed. Ongoing EmberOS end-to-end work was not changed.
