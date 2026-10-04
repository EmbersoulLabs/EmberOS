# Vendored design-rule snapshots

These non-executable summaries preserve only general design knowledge. No
upstream source code, prompt runtime, agent architecture, package, or network
fetch is included. Each source is pinned by repository and commit.

## ChuluuMGL/social-cover-layout

- Commit: `e55e911e4aeac8c2923eb3a7c0f800e37f17a059`
- Source: <https://github.com/ChuluuMGL/social-cover-layout/tree/e55e911e4aeac8c2923eb3a7c0f800e37f17a059>
- License: MIT (upstream repository)
- Knowledge retained: reserve safe margins; establish one primary focal region;
  keep headline placement predictable; validate legibility against the image;
  adapt composition to target aspect ratio.

## sugarforever/01coder-agent-skills

- Commit: `e51fb6e74c41c7828df4c168ddc6f5486592f7a9`
- Source: <https://github.com/sugarforever/01coder-agent-skills/tree/e51fb6e74c41c7828df4c168ddc6f5486592f7a9>
- License: MIT (upstream repository)
- Knowledge retained: express design guidance as versioned, bounded rules;
  separate reusable style intent from task execution; make validation explicit;
  preserve provenance for adopted guidance.

## charlie947/social-media-skills

- Commit: `8cefb5b6d03757885faa6918bd8bfaef202a83db`
- Source: <https://github.com/charlie947/social-media-skills/tree/8cefb5b6d03757885faa6918bd8bfaef202a83db>
- License: MIT (upstream repository)
- Knowledge retained: optimize social covers for immediate scanning; constrain
  headline length; preserve visual hierarchy; account for crop-safe zones; use
  contrast deliberately.

## Local use

The retained rules informed the preset defaults and cover constraints in
`packages/shared/src/visual-style-authority.ts`. EmberOS contracts, ownership,
validation, fingerprints, and UI were independently implemented. This snapshot
does not replace the upstream license notices; the repositories and exact
revisions above are the provenance authority.
