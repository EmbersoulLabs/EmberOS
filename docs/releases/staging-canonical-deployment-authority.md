# EmberOS canonical staging deployment authority

The canonical EmberOS V1 staging web entrypoint is:

`https://emberos-git-staging-kahliantoo-8279s-projects.vercel.app`

This stable alias is a routing name, not sufficient evidence of deployment
identity by itself. Before any staging release certification or paid provider
execution, the release operator must independently resolve and record:

1. the Vercel deployment ID and immutable deployment URL currently behind the
   alias;
2. the exact Git source revision and source branch;
3. the Vercel environment, which must be Preview and treated as STAGING;
4. the runtime region, which must be `sin1` for the canonical V1 staging
   runtime; and
5. successful authenticated health, workspace, AI Story, private-media, and
   Post-QC preflight checks against that resolved deployment.

The alias must not be moved until the target immutable deployment has passed
those identity and runtime checks. Production deployments, Production aliases,
Production data, and R4 are outside this staging authority.
