# Pilot Workspace Setup — 试点客户 Workspace 配置模板

Use this when onboarding **one agency pilot client** for Phase 1 (#5). One client = one workspace.

See also: [AGENCY_ONBOARDING.md](./AGENCY_ONBOARDING.md) (day-to-day workflow).

---

## 1. Naming & slug

| Field | Rule | Example |
|-------|------|---------|
| **name** | Client brand / display name | `Bloom Florist` |
| **slug** | Lowercase, URL-safe, unique within org | `bloom-florist` |

**Slug conventions**

- Use client brand, not your agency name
- `a-z`, `0-9`, hyphens only; no spaces
- Keep short (≤ 24 chars) for URLs and metrics CLI
- One pilot client → one slug; do not reuse for another brand

```
/w/bloom-florist/campaigns
pnpm pilot:metrics -- --slug bloom-florist
```

**Examples by vertical**

| Vertical | name | slug |
|----------|------|------|
| Florist | Bloom Florist | `bloom-florist` |
| F&B | Laksa Lab | `laksa-lab` |
| Wedding | Jade Weddings | `jade-weddings` |
| Property | Harbor Realty | `harbor-realty` |

---

## 2. Create workspace (UI)

1. Log in → **Workspaces** → **New Workspace**
2. **name** = client brand (table above)
3. Slug is auto-derived from name (edit in DB if you need exact slug)
4. Open workspace → run pilot campaigns from `/w/{slug}/campaigns`

**Optional at create time (API)** — `brandProfile` only; no settings UI yet:

```http
POST /api/workspaces
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "orgId": "<your-org-uuid>",
  "name": "Bloom Florist",
  "slug": "bloom-florist",
  "brandProfile": {
    "tone": "warm, approachable, premium",
    "industry": "florist",
    "targetAudience": "Couples planning weddings in Singapore",
    "bannedWords": ["cheap", "discount", "guaranteed viral"],
    "cta": "DM us for a free quote",
    "locale": "en-SG"
  }
}
```

---

## 3. `settings` — review & pilot (SQL)

Review flow is controlled by `workspaces.settings` (JSON). **There is no settings screen yet** — set via Supabase SQL Editor after create.

### Agency pilot (recommended)

Internal QC → **Client Portal** → export. Default for new workspaces.

```sql
UPDATE workspaces
SET settings = '{
  "reviewMode": "internal_then_client",
  "pilot": {
    "startedAt": "2026-06-27",
    "contact": "client contact name / WeChat",
    "targetCampaigns": 3,
    "notes": "Phase 1 agency pilot"
  }
}'::jsonb
WHERE slug = 'bloom-florist';
```

Do **not** set `skipClientReview: true` or `reviewMode: "internal_only"` for agency pilots.

### Self-use / dogfood only (skip client)

```json
{
  "skipClientReview": true
}
```

or `"reviewMode": "internal_only"` — same effect.

### Verify

```sql
SELECT slug, name, settings, brand_profile
FROM workspaces
WHERE slug = 'bloom-florist';
```

---

## 4. `brandProfile` — copy & compliance

Used by Copy / Compliance agents (tone, banned words, CTA, optional logo watermark).

```sql
UPDATE workspaces
SET brand_profile = '{
  "tone": "warm, approachable, premium",
  "industry": "florist",
  "targetAudience": "Wedding & event clients, 25–40, Singapore",
  "bannedWords": ["cheap", "guaranteed", "100%"],
  "cta": "WhatsApp us for a quote",
  "locale": "en-SG",
  "logoUrl": ""
}'::jsonb
WHERE slug = 'bloom-florist';
```

| Field | Purpose |
|-------|---------|
| `tone` | Voice for hooks / body |
| `industry` | Strategy & BGM hints |
| `targetAudience` | CEO / copy context |
| `bannedWords` | Compliance + copy guardrails |
| `cta` | Default CTA when brief is empty |
| `locale` | Default language bias (`en-SG`, `zh-SG`) |
| `logoUrl` | Optional watermark path (Worker) |

---

## 5. Role template — who does what

### People

| Person | EmberOS account? | Role |
|--------|------------------|------|
| Agency lead / you | Yes | `admin` |
| Video operator | Yes | `operator` |
| QC reviewer | Yes | `reviewer` (or `admin`) |
| **Client (甲方)** | **No** | **Client Portal only** (magic link) |

Clients never get `workspace_members` rows — they use `/portal/{token}` only.

### Permissions (workspace RBAC)

| Role | Upload & Run | Edit copy | Internal review | Export | Invite portal |
|------|:------------:|:---------:|:---------------:|:------:|:-------------:|
| **admin** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **operator** | ✓ | ✓ | submit | ✓ | — |
| **editor** | ✓ | ✓ | — | — | — |
| **reviewer** | — | — | ✓ | — | — |
| **publisher** | — | — | — | ✓ | — |

**Minimal pilot team (2 people)**

| User | Suggested role |
|------|----------------|
| You | `admin` |
| Same person wearing QC hat | `admin` (or add second account as `reviewer`) |

**Slightly larger (3 people)**

| User | Role |
|------|------|
| Account lead | `admin` |
| Editor / runner | `operator` |
| QC | `reviewer` |

### Add members (SQL)

Creator is auto-`admin` on workspace create. Add teammates via Supabase (replace UUIDs):

```sql
-- Find user id: pnpm --filter @ceo-agent/db exec tsx scripts/list-users.ts

INSERT INTO workspace_members (org_id, workspace_id, user_id, role)
SELECT
  w.org_id,
  w.id,
  '<supabase-user-uuid>'::uuid,
  'reviewer'
FROM workspaces w
WHERE w.slug = 'bloom-florist'
ON CONFLICT DO NOTHING;
```

Roles: `admin` | `operator` | `editor` | `reviewer` | `publisher` | `client_viewer`

---

## 6. Pilot checklist (copy per client)

```markdown
Client: Bloom Florist
Slug:   bloom-florist
Start:  2026-06-27

[ ] Workspace created (UI)
[ ] settings.reviewMode = internal_then_client (SQL)
[ ] brand_profile filled (SQL or API)
[ ] Team roles assigned (SQL if >1 user)
[ ] Campaign 1: upload → Run → internal approve → portal → client approve → export
[ ] Campaign 2: ...
[ ] Campaign 3: ...
[ ] pnpm pilot:metrics -- --slug bloom-florist
[ ] Internal first-pass ≥ 70%, resubmit ≤ 30%
```

---

## 7. Quick reference — one client block

Fill in and keep in Notion / issue tracker:

```
┌─────────────────────────────────────────┐
│ PILOT CLIENT                            │
├─────────────────────────────────────────┤
│ Brand:     Bloom Florist                │
│ Slug:      bloom-florist                │
│ Industry:  florist                      │
│ Contact:   ___________ (WeChat/email)   │
│ Portal:    internal → client (default)  │
├─────────────────────────────────────────┤
│ EmberOS admin:    you@agency.com        │
│ Operator:         (same or teammate)    │
│ Reviewer:         (same or teammate)    │
│ Client reviewer:  portal link only      │
├─────────────────────────────────────────┤
│ Target: 3 campaigns by __________       │
│ Metrics: pnpm pilot:metrics -- --slug … │
└─────────────────────────────────────────┘
```

---

## Related

- [AGENCY_ONBOARDING.md](./AGENCY_ONBOARDING.md) — full workflow
- `pnpm pilot:metrics -- --list` — list workspaces & review counts
- `packages/shared/src/review-flow.ts` — `skipClientReview` logic
