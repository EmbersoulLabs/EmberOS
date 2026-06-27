# Agency Onboarding — 代运营操作手册

**注册登录 → 每客户一个 Workspace → 内审 + Client Portal**

Production: **https://emberos-iota.vercel.app**

---

## Overview

| Mode | Who uses it | Workspace meaning | Review chain |
|------|-------------|-------------------|--------------|
| Self-use | Your own brand | Brand A / Brand B | Internal review → export |
| **Agency (代运营)** | **Your team + clients** | **One workspace per client** | **Internal QC → Client Portal → export** |
| SaaS (Phase 2) | Paying tenants | Tenant-managed brands | Configurable |

Phase 1 has **no public “apply for agency” form**. Register, log in, and create one workspace per client.

---

## 1. Register and log in

1. Open `/login`
2. Click **Sign up** and register with email (verify via inbox)
3. After login you land on **Workspaces** (`/workspaces`)
4. First visit auto-creates an Organization (default name: EmberSoulLabs)

> One account = your agency. Use multiple workspaces to separate client accounts.

---

## 2. Create a workspace per client

1. On Workspaces, click **New Workspace**
2. Use the client brand name, e.g.:
   - `Florist A` → slug `florist-a`
   - `Restaurant B` → slug `restaurant-b`
3. Click **Create** → enter that workspace’s campaign list

**Rule: one client = one workspace** (data isolation + pilot metrics).

```
Your Organization
├── Workspace: Client A
├── Workspace: Client B
└── Workspace: Client C
```

---

## 3. Run a campaign for a client

Path: `/w/{slug}/campaigns`

| Step | Action |
|------|--------|
| 1 | **New Campaign** — fill brief (goal, platforms, style, voice, BGM) |
| 2 | Upload assets (video and/or images) |
| 3 | Open Campaign **Dashboard** → **Run EmberOS** |
| 4 | Wait for pipeline (~5–15 min) → 3 clip previews on dashboard |
| 5 | Status becomes **pending internal review** → proceed to review |

The worker must be running (Railway production or local `pnpm worker`).

---

## 4. Internal review (your QC)

Path: `/w/{slug}/reviews`

Or use **Open review queue** on the Campaign Dashboard.

For each pending clip:

| Action | Result |
|--------|--------|
| **Approve** | Internal pass → **Client Portal link** shown in a prompt (copy and send) |
| **Reject** | Creative → `compliance_failed` → edit copy and resubmit |

After internal approve, campaign status becomes `pending_client_review`. Send the portal link to the client (WeChat, email, etc.).

Portal URL format:

```
https://emberos-iota.vercel.app/portal/{token}
```

- Client **does not need to log in**
- Token is scoped to one creative
- Link expires in **7 days** (`PORTAL_TOKEN_EXPIRY_DAYS`)

---

## 5. Client Portal (client review)

Client opens the link and:

1. Watches the preview
2. Optionally adds a comment
3. Clicks **Approve** or **Reject**

| Client action | System behavior |
|---------------|-----------------|
| Approve | Creative → `approved` → final render queued → export unlocked |
| Reject | Creative → `compliance_failed` → your team edits and resubmits |

---

## 6. After rejection — edit and resubmit

Path: `/w/{slug}/creatives/{id}`

1. Read the **Review rejected** banner and feedback
2. **Edit copy** (hook / body / CTA)
3. If voice/subtitles changed, wait for re-render to finish
4. **Resubmit for review** → back to internal queue
5. Internal approve again → send a new portal link to the client

Rejected clips also show **Fix clip N** shortcuts on the Campaign Dashboard.

---

## 7. Export and deliver

After client approval (`approved` / `export_ready`):

1. Creative page → **Export**, or
2. Campaign Dashboard → **Export pack**
3. Download ZIP (MP4 + cover + copy)

---

## End-to-end flow

```
Register / login
  → New workspace (Client A)
    → New campaign + upload
      → Run EmberOS
        → 3 clips ready
          → Internal review (/reviews)
            ├─ Reject → edit copy → resubmit → internal review
            └─ Approve → copy portal link
                  → Client opens /portal/{token}
                    ├─ Reject → edit → resubmit
                    └─ Approve → Export ZIP
```

---

## Agency configuration

| Item | Recommendation |
|------|----------------|
| Client Portal | On by default after internal approve |
| `skipClientReview` | **Do not enable** (self-use only; skips client portal) |
| Setting location | DB `workspace.settings` only (no UI yet); new workspaces default to portal flow |
| Roles | Your team: Admin / Operator / Reviewer; clients: portal only, no account |
| Pilot metrics | `pnpm pilot:metrics -- --slug <client-slug>` |

To force internal-only review (self-use):

```json
{ "skipClientReview": true }
```

or `"reviewMode": "internal_only"` in `workspace.settings`.

---

## First client checklist

- [ ] Register and log in
- [ ] Create workspace with a clear client name/slug
- [ ] Run one campaign (upload → Run → 3 clips)
- [ ] Approve all clips in internal review queue
- [ ] Send portal link; client confirms it opens
- [ ] Client approves; export ZIP delivered
- [ ] Run `pnpm pilot:metrics -- --slug <slug>` for approval/resubmit rates

Phase 1 pilot targets (see `PLAN_PROMPT.md`):

- Internal first-pass approval **≥ 70%**
- Resubmit rate after rejection **≤ 30%**

---

## Troubleshooting

**Review queue empty**

Pipeline may still be running, or clips are not yet `pending_internal_review`. Check Campaign Dashboard progress; use **Submit review** on the creative page if needed.

**No portal link after approve**

Link appears when internal review is **Approve** and `skipClientReview` is not set. Check the browser prompt on the Reviews page.

**Client link expired or broken**

Invites expire after 7 days. Re-approve internally to generate a new invite (or inspect `client_invites` in the database).

**Export disabled**

Requires internal + client approval. `compliance_failed` blocks export until rework and re-approval.

---

## Related docs

- [README.md](../README.md) — product overview and path B (agency)
- [PILOT_WORKSPACE_SETUP.md](./PILOT_WORKSPACE_SETUP.md) — slug, settings, roles template per client
- [PHASE1_MVP_PLAN.md](./PHASE1_MVP_PLAN.md) — MVP scope and review state machine
- Pilot metrics: `pnpm pilot:metrics -- --help`
