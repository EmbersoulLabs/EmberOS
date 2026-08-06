# Database SQL Patch Checklist

EmberOS SQL patches are applied explicitly. Adding a patch file and an apply
script is not sufficient by itself.

For every new SQL patch:

1. Make the patch additive and idempotent where practical.
2. Add its apply command to `packages/db/package.json`.
3. Add the patch, in dependency order, to the guarded coordinated migration
   runner for the environment that needs it.
4. Add a test proving the coordinated runner includes the patch.
5. Before execution, confirm the database project reference and the available
   backup or point-in-time recovery strategy. Never print connection secrets.
6. Capture read-only pre-migration row counts and schema state.
7. Apply only the reviewed patch. Do not use `drizzle push` for production
   drift repair.
8. Verify column type, nullability, default, row counts, and the affected API.
9. Record the applied patch in the deployment record for that environment.

PD-042 was previously available only through
`sql:business-profile-pd042`; it was omitted from the coordinated Preview list.
It is now included before the Campaign Workspace patches because Campaign
creation reads Business Profile publishing defaults.
