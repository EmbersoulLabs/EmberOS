# AIGC CEO for Marketing — Phase 1 MVP 实施计划

> **状态**：待确认 · **确认后**再 scaffold monorepo  
> **开发者**：1 人 solo + Cursor · **周期**：16 周 · **预算**：S$5k–10k / 6 个月

---

## 1. Executive Summary

**AIGC CEO for Marketing** 是一个面向新加坡/SEA 的 AI 营销流水线：用户上传视频或图片，由 **CEO Agent** 编排 5 个子 Agent（Vision / Copy / Edit / Compliance / Publish-export），在 **10 分钟内**产出 9:16 成片 + 3 套平台适配文案，经内部与客户（代运营场景）审核后 **导出 ZIP 包**（Phase 1 不做平台自动发布）。

技术栈固定为 **Next.js + Supabase + BullMQ + FFmpeg Worker** 的 pnpm monorepo，以 **Workspace** 为数据隔离边界，支持自用、代运营多客户、未来 SaaS 扩展（Phase 1 不做计费）。计划按 **16 周** 分 4 个月交付：M1 基建与上传 → M2 Agent 编排与文案 → M3 FFmpeg 渲染与审核 → M4 Client Portal + Export + 试点稳定化。

单 Campaign 成本目标 **~S$0.75**（LLM ≤ S$0.50 + 渲染/存储 ≤ S$0.25），通过 CEO 成本守卫、720p 预览、retry 上限 2 次、长视频 ASR 摘要等 guardrails 控制。

---

## 2. Architecture Decisions (ADR)

| ID | 决策 | 选择 | 理由 | 备选（不选原因） |
|----|------|------|------|------------------|
| ADR-001 | Monorepo 工具 | **pnpm workspaces + Turborepo** | 依赖去重、task 缓存、solo 友好 | Nx 过重；多 repo 增加 CI 成本 |
| ADR-002 | ORM | **Drizzle ORM** | SQL-first、轻量、与 Supabase Postgres 直连、migration 简单 | Prisma schema 黑盒、冷启动慢、bundle 大 |
| ADR-003 | Auth | **Supabase Auth** | Magic Link / Email 开箱即用、RLS 原生 | Clerk 额外成本；自研 JWT 维护高 |
| ADR-004 | 多租户隔离 | **Postgres RLS + 应用层 workspace_id 强制过滤** | 双层防御；Client Portal 用 scoped token 绕过 RLS | 仅应用层过滤风险高 |
| ADR-005 | 队列 | **BullMQ + Upstash Redis** | 成熟、延迟任务、重试、优先级；Upstash 按量付费适合 MVP | Inngest 成本高；SQS 本地开发差 |
| ADR-006 | Agent 编排 | **自研 Task Graph 状态机**（`packages/agents`） | 5 个 Agent、线性+并行步骤清晰；无 LangGraph 学习曲线 | LangGraph 对 solo 过度；Temporal 运维重 |
| ADR-007 | 视频渲染 | **FFmpeg CLI in Worker Docker** | 字幕/裁切/转码成熟；S$0 许可；SEA 部署简单 | Remotion 需 React 渲染农场，成本高、复杂 |
| ADR-008 | 存储 | **Supabase Storage**（按 workspace 路径前缀） | 与 Auth/DB 一体；presigned URL | S3 需额外 IAM；OSS 非首发市场 |
| ADR-009 | Web 部署 | **Vercel**（`apps/web`） | Next.js 原生；Preview 部署 | Railway 全栈可以但 web 冷启动不如 Vercel |
| ADR-010 | Worker 部署 | **Railway / Fly.io**（Docker + FFmpeg） | 长任务、大内存、自定义镜像 | Vercel Serverless 不适合 FFmpeg |
| ADR-011 | LLM | **OpenAI GPT-4o-mini**（Vision/Copy）+ **Whisper**（ASR） | 成本可控；JSON mode 稳定 | Claude 可作 Copy fallback（Phase 1.5） |
| ADR-012 | 向量/RAG | **Phase 1 硬编码爆款模板 JSON** | 省 Pinecone 费用；验证文案质量先 | pgvector 放 Phase 1.5 |
| ADR-013 | 发布策略 | **Export ZIP only** | 规避抖音/小红书/TikTok OAuth 资质 | 自动发布 → Phase 1.5 |
| ADR-014 | 实时进度 | **Supabase Realtime** on `tasks` 表 | 少写 WebSocket；Task 页订阅 | SSE 自建维护成本 |
| ADR-015 | 平台规格 | **`packages/shared/platform-specs`** | 9:16、字数、标签格式集中定义 | 散落各 Agent 难维护 |

---

## 3. Database Schema

### 3.1 命名与隔离约定

- 所有业务表（除 `organizations`）含 **`org_id`** + **`workspace_id`**
- 主键：`uuid`（`gen_random_uuid()`）
- 时间戳：`created_at`, `updated_at`（trigger 自动更新）
- 软删除：`deleted_at`（可选，Campaign/Asset 用）
- **RLS 策略**：`workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())`

### 3.2 ER 关系

```
organizations 1──* workspaces 1──* campaigns 1──* assets
                                      │
                                      └──* tasks 1──1 creatives
                                              │
                                              └──* reviews
campaigns 1──* publish_jobs (Phase 1 仅 export 状态)
workspaces 1──* client_invites
organizations 1──* usage_records
```

### 3.3 表定义

#### `organizations`
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| name | text NOT NULL | 公司/团队名 |
| slug | text UNIQUE | URL 友好 |
| plan | text DEFAULT 'free' | Phase 2 计费预留 |
| settings | jsonb DEFAULT '{}' | 全局配置 |
| created_at | timestamptz | |

#### `organization_members`
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| org_id | uuid FK → organizations | |
| user_id | uuid FK → auth.users | Supabase Auth |
| role | text | `owner` \| `admin` \| `member` |
| created_at | timestamptz | |
| UNIQUE(org_id, user_id) | | |

#### `workspaces`
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | **隔离边界** |
| org_id | uuid FK NOT NULL | |
| name | text NOT NULL | 品牌/客户名 |
| slug | text NOT NULL | org 内唯一 |
| brand_profile | jsonb DEFAULT '{}' | 品牌调性、禁用词、行业 |
| platform_accounts | jsonb DEFAULT '[]' | Phase 1.5 发布账号预留 |
| settings | jsonb DEFAULT '{}' | 默认平台、语言 |
| created_at | timestamptz | |
| UNIQUE(org_id, slug) | | |

#### `workspace_members`
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| org_id | uuid FK NOT NULL | 冗余便于 RLS |
| workspace_id | uuid FK NOT NULL | |
| user_id | uuid FK | nullable（Client 无 user） |
| role | text | `admin` \| `operator` \| `editor` \| `reviewer` \| `publisher` \| `client_viewer` |
| created_at | timestamptz | |
| UNIQUE(workspace_id, user_id) | | |

#### `campaigns`
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| org_id | uuid FK NOT NULL | |
| workspace_id | uuid FK NOT NULL | |
| name | text NOT NULL | |
| goal | text | 营销目标描述 |
| platforms | text[] | `['tiktok','xiaohongshu','instagram']` |
| status | text | 见状态机 §3.4 |
| metadata | jsonb DEFAULT '{}' | UTM、产品链接等 |
| created_by | uuid | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `assets`
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| org_id | uuid FK NOT NULL | |
| workspace_id | uuid FK NOT NULL | |
| campaign_id | uuid FK NOT NULL | |
| type | text | `video` \| `image` |
| storage_path | text NOT NULL | `{workspace_id}/campaigns/{id}/...` |
| mime_type | text | |
| duration_sec | numeric | 视频 |
| width / height | int | |
| file_size_bytes | bigint | |
| metadata | jsonb | `fps`, `codec`, `thumbnail_path` |
| created_at | timestamptz | |

#### `tasks`
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| org_id | uuid FK NOT NULL | |
| workspace_id | uuid FK NOT NULL | |
| campaign_id | uuid FK NOT NULL | |
| status | text | `queued` \| `running` \| `completed` \| `failed` |
| ceo_plan | jsonb | TaskGraph JSON |
| current_step | text | 当前 Agent 步骤 id |
| step_progress | jsonb | `{ stepId: { status, startedAt, output, error } }` |
| retry_count | int DEFAULT 0 | CEO 全局 retry ≤ 2 |
| cost_usd | numeric DEFAULT 0 | 累计 LLM 成本 |
| cost_budget_usd | numeric DEFAULT 0.50 | |
| error_message | text | |
| started_at / completed_at | timestamptz | |
| created_at | timestamptz | |

#### `creatives`
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| org_id | uuid FK NOT NULL | |
| workspace_id | uuid FK NOT NULL | |
| campaign_id | uuid FK NOT NULL | |
| task_id | uuid FK UNIQUE | |
| status | text | 见 §3.4 审核状态 |
| copy_variants | jsonb | `[{ id, hook, body, cta, tags, title, platform }]` × 3 |
| selected_copy_id | text | 审核通过的文案 variant id |
| video_url | text | 预览 720p |
| video_export_url | text | 导出 1080p |
| cover_url | text | |
| edit_plan | jsonb | Edit Director 输出 |
| compliance_result | jsonb | Compliance Agent 输出 |
| platform_adaptations | jsonb | 各平台格式化 metadata |
| version | int DEFAULT 1 | 重跑 copy/edit 时递增 |
| created_at / updated_at | timestamptz | |

#### `reviews`
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| org_id | uuid FK NOT NULL | |
| workspace_id | uuid FK NOT NULL | |
| creative_id | uuid FK NOT NULL | |
| reviewer_type | text | `internal` \| `client` |
| reviewer_id | uuid | internal 时 auth user |
| reviewer_email | text | client 时记录 |
| decision | text | `pending` \| `approved` \| `rejected` |
| comment | text | |
| decided_at | timestamptz | |
| created_at | timestamptz | |

#### `client_invites`
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| org_id | uuid FK NOT NULL | |
| workspace_id | uuid FK NOT NULL | |
| creative_id | uuid FK | 单条 creative scope；null = workspace 级 |
| token | text UNIQUE NOT NULL | crypto random 32 bytes hex |
| email | text | 客户邮箱（可选） |
| expires_at | timestamptz NOT NULL | 默认 7 天 |
| used_at | timestamptz | |
| created_by | uuid | |
| created_at | timestamptz | |

#### `publish_jobs`（Phase 1 仅 export 追踪）
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| org_id / workspace_id | uuid FK | |
| creative_id | uuid FK | |
| platform | text | |
| status | text | `export_pending` \| `export_ready` \| `failed` |
| export_pack_url | text | ZIP URL |
| external_post_id | text | Phase 1.5 |
| scheduled_at | timestamptz | Phase 1.5 |
| created_at | timestamptz | |

#### `usage_records`（Phase 2 计费预留）
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| org_id | uuid FK NOT NULL | |
| workspace_id | uuid FK | nullable |
| metric | text | `llm_tokens`, `render_sec`, `storage_bytes` |
| amount | numeric | |
| metadata | jsonb | |
| created_at | timestamptz | |

#### `agent_logs`（调试与成本审计）
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | |
| org_id / workspace_id / task_id | uuid FK | |
| agent | text | `ceo` \| `vision` \| `copy` \| ... |
| input_tokens / output_tokens | int | |
| cost_usd | numeric | |
| input_summary / output_json | jsonb | 脱敏摘要 |
| duration_ms | int | |
| created_at | timestamptz | |

### 3.4 状态机

**Campaign.status**
```
draft → processing → pending_internal_review → pending_client_review → approved → export_ready
                  ↘ failed
```
- `pending_client_review`：仅代运营模式（有 client_invite 时）
- 自用模式：internal approved 后直接 → `approved`

**Creative.status**（与 Campaign 同步，细粒度）
```
draft → processing → compliance_failed → pending_internal_review → pending_client_review → approved → exported
```

**Task.status**：`queued` → `running` → `completed` | `failed`

**Review 驳回回流**：
- 驳回 copy → 重跑 `copy_generate` + `compliance_check`（不重新 FFmpeg）
- 驳回 edit → 重跑 `edit_director_plan` → `ffmpeg_render` → `compliance_check`
- CEO `retry_count` +1，上限 2

---

## 4. API Spec

**通用约定**
- Base：`/api`
- Auth：Supabase JWT in `Authorization: Bearer`（Portal 路由除外）
- 所有写操作需 `workspace_id` 校验 membership
- 错误：`{ error: string, code: string }`
- 分页：`?cursor=&limit=20`

### 4.1 Auth & Tenant

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/me` | User | — | `{ user, orgs: [{ id, name, role }], workspaces: [...] }` |
| POST | `/api/organizations` | User | `{ name, slug }` | `{ organization }` |
| POST | `/api/workspaces` | Org member | `{ orgId, name, slug, brandProfile? }` | `{ workspace }` |
| GET | `/api/workspaces` | User | `?orgId=` | `{ workspaces: [...] }` |
| GET | `/api/workspaces/:id` | Member | — | `{ workspace, members, stats }` |
| POST | `/api/workspaces/:id/invites` | Admin | `{ creativeId?, email?, expiresInDays?: 7 }` | `{ inviteUrl, token, expiresAt }` |

### 4.2 Campaign & Asset

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/campaigns` | Operator+ | `{ workspaceId, name, goal, platforms[] }` | `{ campaign }` |
| GET | `/api/campaigns` | Member | `?workspaceId=&status=` | `{ campaigns, nextCursor }` |
| GET | `/api/campaigns/:id` | Member | — | `{ campaign, assets, task, creative }` |
| PATCH | `/api/campaigns/:id` | Operator+ | `{ name?, goal?, platforms? }` | `{ campaign }` |
| POST | `/api/campaigns/:id/assets/upload-url` | Operator+ | `{ filename, mimeType, type }` | `{ uploadUrl, assetId, storagePath }` |
| POST | `/api/campaigns/:id/assets/:assetId/confirm` | Operator+ | `{ width?, height?, durationSec? }` | `{ asset }` |
| DELETE | `/api/campaigns/:id/assets/:assetId` | Operator+ | — | `{ success: true }` |

### 4.3 CEO Pipeline

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/campaigns/:id/run` | Operator+ | `{ force?: boolean }` | `{ taskId, status: 'queued' }` |
| GET | `/api/tasks/:id` | Member | — | `{ task, stepProgress, creative? }` |
| POST | `/api/tasks/:id/retry` | Operator+ | `{ step: 'copy' \| 'edit' \| 'full' }` | `{ taskId, status }` |
| GET | `/api/tasks/:id/logs` | Member | — | `{ logs: agent_logs[] }` |

### 4.4 Creative & Review

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/creatives/:id` | Member | — | `{ creative, campaign, reviews }` |
| PATCH | `/api/creatives/:id/copy` | Editor+ | `{ variantId, hook?, body?, cta?, tags? }` | `{ creative }` |
| POST | `/api/creatives/:id/submit-review` | Editor+ | `{ type: 'internal' \| 'client' }` | `{ review, campaignStatus }` |
| GET | `/api/reviews` | Reviewer+ | `?workspaceId=&status=pending` | `{ reviews[] }` |
| POST | `/api/reviews/:id/decide` | Reviewer+ | `{ decision: 'approved' \| 'rejected', comment? }` | `{ review, creative, nextAction? }` |

### 4.5 Client Portal（无 JWT）

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/portal/:token` | Portal token | — | `{ creative, campaign, brandName, reviews }` |
| POST | `/api/portal/:token/decide` | Portal token | `{ decision, comment? }` | `{ review, status }` |

Portal token 校验：`client_invites.token` + `expires_at` + `creative_id` scope

### 4.6 Export

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/creatives/:id/export` | Publisher+ | `{ platforms[]?, resolution?: '1080p' }` | `{ jobId, status: 'export_pending' }` |
| GET | `/api/creatives/:id/export` | Member | — | `{ status, exportPackUrl?, contents[] }` |

Export ZIP 内容：
```
export/
├── video_9x16_1080p.mp4
├── cover.jpg
├── copy/
│   ├── tiktok_variant_1.md
│   ├── xiaohongshu_variant_1.md
│   └── instagram_variant_1.md
└── metadata.json
```

---

## 5. Agent Prompts & JSON Schemas

### 5.1 CEO Orchestrator

**System Prompt 要点**
- 你是营销任务 CEO，负责将 Campaign 目标拆解为 Task Graph
- 不直接生成文案或剪辑指令，只编排步骤与 retry 策略
- 成本预算上限 ${cost_budget_usd}，优先并行 vision + copy
- 平台：{platforms}，品牌：{brand_profile}
- 输出严格 JSON，符合 TaskGraphSchema

**TaskGraphSchema**
```json
{
  "version": "1.0",
  "steps": [
    { "id": "parse_intent", "agent": "ceo", "dependsOn": [] },
    { "id": "vision_analyze", "agent": "vision", "dependsOn": ["parse_intent"], "parallel": true },
    { "id": "copy_generate", "agent": "copy", "dependsOn": ["parse_intent"], "parallel": true },
    { "id": "edit_director_plan", "agent": "edit", "dependsOn": ["vision_analyze", "copy_generate"] },
    { "id": "ffmpeg_render", "agent": "worker", "dependsOn": ["edit_director_plan"] },
    { "id": "compliance_check", "agent": "compliance", "dependsOn": ["ffmpeg_render", "copy_generate"] },
    { "id": "human_review", "agent": "human", "dependsOn": ["compliance_check"] },
    { "id": "platform_adapt", "agent": "publish", "dependsOn": ["human_review"] }
  ],
  "retryPolicy": {
    "maxRetries": 2,
    "onCopyReject": ["copy_generate", "compliance_check"],
    "onEditReject": ["edit_director_plan", "ffmpeg_render", "compliance_check"]
  },
  "costBudgetUsd": 0.50
}
```

### 5.2 Vision Agent

**System Prompt 要点**
- 分析视频帧/图片：主体、场景、产品、情绪、可用 hook 点
- 长视频（>60s）：仅分析关键帧 + transcript 摘要，不逐帧
- 输出 JSON

**Output Schema：`VisionAnalysis`**
```json
{
  "assetId": "uuid",
  "mediaType": "video",
  "durationSec": 45,
  "subjects": ["product", "person"],
  "scenes": [{ "startSec": 0, "endSec": 15, "description": "...", "emotion": "curious" }],
  "products": [{ "name": "...", "attributes": ["organic", "local"] }],
  "hooks": ["before/after", "problem-solution"],
  "transcriptSummary": "...",
  "suggestedMoments": [{ "startSec": 3.2, "endSec": 8.5, "reason": "strong hook" }],
  "confidence": 0.85
}
```

### 5.3 Copy Agent

**System Prompt 要点**
- 新加坡/SEA 市场，语言：{locale}，平台：{platform}
- 品牌调性：{brand_profile.tone}，禁用词：{brand_profile.bannedWords}
- 生成 **3 套**不同结构文案：痛点型、对比型、故事型（或清单/测评）
- 遵守平台字数：TikTok title≤150, 小红书 title≤20 等（见 platform-specs）
- 输出 JSON，variants 数组长度 = 3

**Output Schema：`CopyVariants`**
```json
{
  "platform": "tiktok",
  "locale": "en-SG",
  "variants": [
    {
      "id": "v1",
      "template": "pain_point",
      "hook": "...",
      "body": "...",
      "cta": "...",
      "title": "...",
      "tags": ["#sgfoodie", "#..."],
      "estimatedReadSec": 8
    }
  ],
  "recommendedVariantId": "v1"
}
```

### 5.4 Edit Director Agent

**System Prompt 要点**
- 输入 vision 关键时刻 + 选定 copy hook + 素材时长
- 输出 FFmpeg 可执行的 timeline JSON（不输出 shell 命令）
- 目标：9:16 竖屏，15–60s，字幕在黄金 3 秒
- 转场简洁，适合短视频平台

**Output Schema：`EditPlan`**
```json
{
  "aspectRatio": "9:16",
  "targetDurationSec": 30,
  "outputResolution": { "preview": "720x1280", "export": "1080x1920" },
  "clips": [
    { "assetId": "uuid", "startSec": 3.2, "endSec": 12.0, "speed": 1.0 }
  ],
  "subtitles": [
    { "startSec": 0, "endSec": 3, "text": "Hook line", "style": "bold_center" }
  ],
  "cover": { "atSec": 1.5, "overlayText": "..." },
  "audio": { "keepOriginal": true, "bgm": null, "normalize": true },
  "effects": [{ "type": "fade_in", "startSec": 0, "durationSec": 0.3 }]
}
```

### 5.5 Compliance Agent

**System Prompt 要点**
- 检查广告法、平台违禁词（新加坡 PDPA 无关但注意医疗/金融声明）
- 检查绝对化用语、虚假宣传
- 品牌禁用词列表必查
- 不通过则 `passed: false` + 修改建议

**Output Schema：`ComplianceResult`**
```json
{
  "passed": true,
  "score": 0.92,
  "flags": [
    { "source": "copy", "variantId": "v2", "word": "best", "reason": "superlative", "suggestion": "top-rated" }
  ],
  "checkedAt": "ISO8601"
}
```

### 5.6 Publish Agent（Phase 1 Export-only）

**System Prompt 要点**
- 将 approved creative 格式化为各平台发布 metadata
- Phase 1 不调用任何平台 API，只生成 export 结构与文件名

**Output Schema：`ExportPack`**
```json
{
  "creativeId": "uuid",
  "platforms": {
    "tiktok": {
      "caption": "...",
      "hashtags": [],
      "videoFile": "video_9x16_1080p.mp4",
      "coverFile": "cover.jpg"
    },
    "xiaohongshu": { "title": "...", "body": "...", "tags": [] }
  },
  "exportManifest": ["video_9x16_1080p.mp4", "cover.jpg", "copy/tiktok.md"]
}
```

---

## 6. FFmpeg Pipeline Spec

### 6.1 输入

Worker 从 `edit_plan` JSON + 源素材 storage path 构建命令。

### 6.2 处理阶段

```
1. probe    → ffprobe 获取 codec/duration
2. extract  → 按 clips[] 切片（-ss -to）
3. concat   → concat demuxer 合并
4. crop     → 9:16 中心裁切（crop + scale）
5. subtitle → ASS 文件烧录（subtitles filter）
6. audio    → loudnorm 归一化
7. cover    → -ss {cover.atSec} -vframes 1
8. encode   → preview: 720x1280 crf23 / export: 1080x1920 crf20
```

### 6.3 命令模板（示意）

**裁切 + 缩放为 9:16**
```bash
ffmpeg -i {input} -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920" -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 128k {output}.mp4
```

**烧录字幕**
```bash
ffmpeg -i {input} -vf "ass={subtitle.ass}" -c:v libx264 -preset fast -crf 20 -c:a copy {output}.mp4
```

**切片**
```bash
ffmpeg -ss {startSec} -to {endSec} -i {input} -c copy {clip}.mp4
```

**合并**
```bash
# concat.txt: file 'clip1.mp4' ...
ffmpeg -f concat -safe 0 -i concat.txt -c copy {merged}.mp4
```

**封面**
```bash
ffmpeg -ss {atSec} -i {input} -vframes 1 -q:v 2 {cover}.jpg
```

**音频归一化**
```bash
ffmpeg -i {input} -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:v copy {output}.mp4
```

### 6.4 Worker Job 类型（BullMQ）

| Queue | Job | 超时 | 并发 |
|-------|-----|------|------|
| `render` | `ffmpeg.render` | 10 min | 2 |
| `export` | `ffmpeg.export` | 5 min | 2 |
| `probe` | `ffmpeg.probe` | 1 min | 5 |
| `agent` | `agent.*` | 3 min | 5 |

### 6.5 存储路径

```
{workspace_id}/campaigns/{campaign_id}/source/{asset_id}.mp4
{workspace_id}/campaigns/{campaign_id}/renders/{creative_id}/preview_720p.mp4
{workspace_id}/campaigns/{campaign_id}/renders/{creative_id}/export_1080p.mp4
{workspace_id}/campaigns/{campaign_id}/exports/{creative_id}/pack.zip
```

---

## 7. Frontend Routes & Components

### 7.1 路由树（`apps/web`）

| 路由 | 页面 | 关键组件 |
|------|------|----------|
| `/login` | LoginPage | `SupabaseAuthForm` |
| `/onboarding` | OnboardingPage | `CreateOrgForm`, `CreateWorkspaceForm` |
| `/` | DashboardRedirect | → `/workspaces` |
| `/workspaces` | WorkspaceListPage | `WorkspaceCard`, `CreateWorkspaceDialog` |
| `/w/[workspaceSlug]/campaigns` | CampaignListPage | `CampaignTable`, `StatusBadge` |
| `/w/[workspaceSlug]/campaigns/new` | CampaignWizardPage | `UploadDropzone`, `PlatformPicker`, `GoalForm` |
| `/w/[workspaceSlug]/campaigns/[id]` | CampaignDetailPage | `AssetGallery`, `RunPipelineButton` |
| `/w/[workspaceSlug]/campaigns/[id]/task` | TaskProgressPage | `StepTimeline`, `AgentLogPanel` (Realtime) |
| `/w/[workspaceSlug]/creatives/[id]` | CreativePreviewPage | `VideoPlayer`, `CopyVariantTabs`, `EditCopyForm` |
| `/w/[workspaceSlug]/reviews` | ReviewQueuePage | `ReviewCard`, `DecideButtons` |
| `/w/[workspaceSlug]/creatives/[id]/export` | ExportPage | `ExportStatus`, `DownloadButton` |
| `/portal/[token]` | ClientPortalPage | `PortalVideoPlayer`, `PassRejectBar`, `CommentBox` |

### 7.2 布局组件

- `AppShell`：sidebar（workspace 切换器）+ header
- `WorkspaceGuard`：校验 membership，注入 `workspaceId`
- `RoleGuard`：按 role 隐藏操作按钮

### 7.3 状态管理

- **Server state**：TanStack Query（campaigns, tasks, creatives）
- **Realtime**：Supabase channel on `tasks:{id}` 更新 `step_progress`
- **表单**：React Hook Form + Zod

---

## 8. Week-by-Week Task Breakdown（16 周）

### M1 — 基建与上传（W1–W4）

| 周 | 交付项 |
|----|--------|
| **W1** | pnpm monorepo scaffold（turbo, tsconfig, eslint）；`packages/shared` 类型；`packages/db` Drizzle schema 初版；`.cursor/rules` 多租户约定；README env 模板 |
| **W2** | Supabase 项目 + migrations；RLS policies；Supabase Auth 接入；`apps/web` Next.js App Router 骨架 + login |
| **W3** | Organization / Workspace CRUD API；Workspace 列表页；workspace slug 路由；成员 role 种子 |
| **W4** | Campaign CRUD；Supabase Storage presigned upload；上传 UI（视频+图片）；`assets` 落库；ffprobe job 写 metadata |

### M2 — Agent 编排与文案（W5–W8）

| 周 | 交付项 |
|----|--------|
| **W5** | `packages/queue` BullMQ 类型 + Redis 连接；`apps/worker` 骨架；`agent.ceo` job：生成 TaskGraph |
| **W6** | Vision Agent（关键帧提取 + GPT-4o-mini vision）；Whisper ASR 长视频；`agent.vision` job |
| **W7** | Copy Agent × 3 variants；`platform-specs` 字数约束；`agent.copy` job；爆款模板 JSON starter |
| **W8** | Task 状态机 + `step_progress` 更新；Campaign Run API；Task 进度页（轮询/Realtime）；成本记录 `agent_logs` |

### M3 — FFmpeg 渲染与审核（W9–W12）

| 周 | 交付项 |
|----|--------|
| **W9** | Edit Director Agent → `EditPlan` JSON；Edit 计划落库 `creatives.edit_plan` |
| **W10** | FFmpeg Worker Docker 镜像；`ffmpeg.render` job（裁切+字幕+预览 720p）；Creative 预览页视频播放器 |
| **W11** | Compliance Agent；compliance_failed 回流 UX；内部 Review 队列 + decide API |
| **W12** | 驳回重跑 copy/edit 路径；`retry_count` 守卫；人工改文案 PATCH API；版本递增 |

### M4 — Portal、Export、稳定化（W13–W16）

| 周 | 交付项 |
|----|--------|
| **W13** | Client invite 生成；`/portal/[token]` 页面；Portal decide API（无 JWT）；代运营 client_review 状态 |
| **W14** | Export job（1080p + ZIP 打包）；Export 页；`publish_jobs` 追踪；Publish Agent metadata |
| **W15** | 2-Workspace 隔离集成测试；API workspace_id 注入 middleware；错误边界 + 队列 dead letter |
| **W16** | 限流（per org 并发 2 campaigns）；监控日志；1 个代运营试点 dogfood；文档收尾；部署 Vercel + Railway |

---

## 9. Risk Register

| # | 风险 | 影响 | 概率 | 缓解措施 |
|---|------|------|------|----------|
| R1 | **10 分钟 SLA 达不到**（长视频渲染慢） | 高 | 中 | 限制上传 ≤3min/500MB；预览 720p；并行 vision+copy；渲染超时 8min 告警 |
| R2 | **LLM 成本超 S$0.75/Campaign** | 高 | 中 | CEO cost_budget 硬限；4o-mini 主力；Vision 关键帧 ≤8 帧；usage_records 日报 |
| R3 | **文案质量不达标**（审核通过率 <70%） | 高 | 中 | 3 模板 + 人工改文案；爆款 starter JSON；Phase 1.5 加 RAG |
| R4 | **FFmpeg 字幕/裁切边缘 case** | 中 | 高 | 固定 9:16 单模板；ASS 样式预设 3 套；失败 fallback 纯裁切无字幕 |
| R5 | **Workspace 数据泄漏** | 极高 | 低 | RLS + middleware 双检；集成测试 2 workspace；Portal token scoped 单 creative |
| R6 | **Solo 16 周延期** | 中 | 高 | 每周 ≤5 项交付；M4 可砍 platform_adapt 多平台，先只做 TikTok+小红书 metadata |
| R7 | **Supabase Storage 出口流量费** | 中 | 中 | 预览用 signed URL 短 TTL；export ZIP 24h 过期；压缩 CRf23 |

---

## 10. Phase 1.5 / Phase 2 Backlog

### Phase 1.5（+4–6 周，MVP 验证后）

- [ ] TikTok / Instagram **OAuth 自动发布**（API 资质就绪后）
- [ ] 小红书发布助手（半自动：复制文案 + 下载视频，仍无全 API）
- [ ] **pgvector RAG**：爆款文案库、品牌历史创意检索
- [ ] Copy Agent **Claude fallback** + A/B 2 变体快速测试
- [ ] Campaign **批量队列**（5 条以内）
- [ ] 基础 **用量仪表盘**（无 Stripe，只看 usage_records）
- [ ] 抖音平台 specs + 合规词库（中国扩展预备）

### Phase 2（6 个月后）

- [ ] **Stripe 计费** + 新加坡 GST 发票
- [ ] SaaS 套餐：Workspace 数量、月 Campaign 额度
- [ ] **A/B 批量渲染**（5–10 变体）
- [ ] 图生视频 / 数字人接入（第三方 API）
- [ ] **数据回流**：发布后播放/互动导入（平台 API）
- [ ] Enterprise **SSO** + 白标 Client Portal
- [ ] 工作流引擎对接（CEO Task Graph 与 ERP/CRM 事件联动）

---

## Definition of Done（Phase 1 验收）

- [ ] 本地 `pnpm dev` 启动 web，`pnpm worker` 消费队列，Redis 连接正常
- [ ] 上传测试视频 → CEO 流水线 → 9:16 预览成片 + 3 套文案 → 内部审核 → export ZIP
- [ ] Client Portal magic link 审片：pass / reject / comment 可用
- [ ] 2 个 Workspace 数据完全隔离（API + RLS 集成测试通过）
- [ ] `.cursor/rules` 写入多租户字段、API workspace 校验、命名约定
- [ ] README 含全部 env 变量与本地启动步骤（含 Docker Worker）
- [ ] 单 Campaign 成本可观测（`agent_logs` + `usage_records` 汇总 ≤ S$0.75 目标）

---

## 确认后下一步

计划确认后，执行：

```
从 M1 W1 开始 scaffold monorepo：
ceo-agent/ → apps/web, apps/worker, packages/{agents,db,queue,shared}
```

请在 Cursor 中回复 **「计划已确认」** 或提出修改意见（如：DB 换 Prisma、首发只做 TikTok、LLM 换 Claude）。
