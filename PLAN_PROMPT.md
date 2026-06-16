# AIGC CEO Marketing — Cursor Plan Prompt

> 复制下方 `---PLAN START---` 到 `---PLAN END---` 之间的全部内容，粘贴到 **Cursor Plan 模式** 或 **新 Agent 会话** 作为规划输入。

---PLAN START---

## 任务

为 **AIGC CEO for Marketing** 平台制定可执行的 **Phase 1 MVP 实施计划**，并在计划确认后 scaffold 代码仓库。

这是一个 **自用 + 代运营 + SaaS** 三合一的 AIGC 营销流水线产品：用户上传视频或图片 → **CEO Agent** 编排子 Agent → 生成爆款文案 + 剪辑成片 + 多平台适配 → 人工/客户审核 → 发布或导出。

## 背景与约束

- **开发者**：1 人 solo，使用 **Cursor Agent** 开发
- **启动预算**：S$5k–10k 现金（6 个月），不含雇人
- **单 Campaign 运营成本目标**：~S$0.75（LLM + 渲染 + 存储）
- **首发市场**：新加坡/SEA 冷启动，架构需支持后续中国（抖音/小红书）扩展
- **MVP 发布策略**：优先 **导出 + 文案包**；平台自动发布作 Phase 1.5（API 资质后置）
- **不要 over-engineer**：最小正确 diff，复用成熟 SaaS（Supabase 等），FFmpeg 先于 Remotion

## 产品目标（Phase 1 必须验证）

1. 上传 1 个视频或 3 张图片 → **10 分钟内**产出可发布的 9:16 成片 + 3 套文案
2. **代运营 Client Portal**：Magic Link 审片，客户可 pass/reject/comment
3. **多 Workspace 隔离**：同一 Organization 下管理多个品牌/甲方客户
4. 审核通过率 > 70%，人工修改文案率 < 30%（内部 dogfood 指标）

## 明确不做（Phase 1 排除）

- 完整 SaaS 计费 + Stripe + GST 发票
- 5–10 条 A/B 批量渲染
- 图生视频 / 数字人 / 复杂时间轴编辑器
- 全平台 OAuth 自动发布（抖音/小红书/TikTok API）
- 数据回流优化闭环
- Enterprise SSO / 白标

## 目标架构（Logical）

```
Client (Web Console + Client Portal)
  → API Gateway (Auth + RBAC + Usage Meter)
    → Core Services (Campaign / Asset / Review / Publish API)
      → CEO Orchestrator (Task Graph + Dispatcher + Retry + Cost Guard)
        → Sub-Agents: Vision | Copy | Edit Director | Compliance | Publish
          → BullMQ → Worker (FFmpeg: 字幕 + 裁切 + 封面)
            → Object Storage
      → PostgreSQL + Redis + Vector DB (品牌/爆款 RAG，Phase 1 可简化为 JSON 模板)
```

## 多租户模型

```
Platform → Organization → Workspace → Campaign → Creative Task
```

- **Workspace** 是数据隔离边界（素材、品牌手册、审核、发布账号）
- **RBAC 角色**：Workspace Admin | Operator | Editor | Reviewer | Publisher | Client Viewer

## CEO Task Graph（核心流水线）

```
upload → parse_intent → ceo_plan
  → vision_analyze ∥ copy_generate
  → edit_director_plan → ffmpeg_render → compliance_check
  → human_review (internal → client for 代运营)
  → platform_adapt → publish_or_export
```

- review 驳回 → 仅重跑 copy 或 edit（CEO 控制 retry 上限 2 次）
- 状态机：`draft → processing → pending_internal_review → pending_client_review → approved → scheduled → published | failed`

## 技术栈（固定，勿替换除非有充分理由）

| 层 | 选型 |
|----|------|
| 全栈 Web | Next.js 14+ App Router, TypeScript |
| DB + Auth | Supabase (Postgres + Auth) |
| ORM | Drizzle 或 Prisma（选一个并说明理由） |
| 队列 | BullMQ + Upstash Redis |
| Agent | 自研状态机 + OpenAI SDK（或 LangGraph，选更简单的） |
| 视频 | FFmpeg CLI in Worker |
| 存储 | Supabase Storage 或 S3/OSS |
| 部署 | Vercel (web) + Railway/Fly (worker) |
| Cursor | `.cursor/rules` 约束多租户字段与 API 约定 |

## Monorepo 结构（计划需产出并 scaffold）

```
ceo-agent/
├── apps/web/                 # Next.js 控制台 + Client Portal + API Routes
├── apps/worker/              # BullMQ consumer + FFmpeg
├── packages/agents/          # CEO + Vision + Copy + Compliance
├── packages/db/              # schema + migrations
├── packages/queue/           # job types
├── packages/shared/          # types, platform specs (抖音/小红书/TikTok)
├── .cursor/rules/
└── infra/docker/             # Worker 镜像（含 FFmpeg）
```

## 核心数据模型（计划需细化字段）

- `organizations`, `workspaces`, `workspace_members`
- `campaigns`, `assets` (video|image)
- `tasks` (CEO 执行单元, status, ceo_plan JSON)
- `creatives` (copy_variants[], video_url, cover_url, platform_specs)
- `reviews` (reviewer_type: internal|client, decision, comments)
- `publish_jobs` (platform, schedule_at, external_post_id, status)
- `client_invites` (workspace_id, token, expires_at) — 代运营 Portal
- `usage_records` (org_id, metric, amount) — 为 Phase 2 计费预留

所有业务表必须含 `org_id` + `workspace_id`，所有查询强制过滤。

## Phase 1 API 清单（计划需列出 request/response 概要）

### Auth & Tenant
- `POST /api/workspaces` — 创建 Workspace
- `GET /api/workspaces` — 列表（代运营看板）
- `POST /api/workspaces/:id/invites` — 生成 Client Portal magic link

### Campaign & Asset
- `POST /api/campaigns` — 创建活动（goal, platforms[]）
- `POST /api/campaigns/:id/assets` — 上传视频/图片（presigned URL）
- `GET /api/campaigns/:id` — 详情 + 任务状态

### CEO Pipeline
- `POST /api/campaigns/:id/run` — 触发 CEO 任务
- `GET /api/tasks/:id` — 任务状态 + 子步骤进度
- `POST /api/tasks/:id/retry` — 指定 Agent 重跑

### Creative & Review
- `GET /api/creatives/:id` — 预览（文案 + 视频 URL）
- `PATCH /api/creatives/:id/copy` — 人工改文案
- `POST /api/creatives/:id/submit-review` — 提交审核
- `POST /api/reviews/:id/decide` — pass | reject + comment
- `GET /api/portal/:token` — Client Portal 只读 + 审核（无需登录）

### Export
- `POST /api/creatives/:id/export` — 打包成片 + 文案 + 标签 ZIP

## Agent 设计（计划需写出每个 Agent 的 input/output schema）

### CEO Orchestrator
- Input: campaign goal, platforms[], asset metadata, brand_profile
- Output: TaskGraph JSON（步骤、依赖、retry 策略、成本预算）
- 职责：调度、质检评分、失败重试、不直接剪视频

### Vision Agent
- Input: asset URLs, sample frames
- Output: `{ subjects, scenes, products, emotions, hooks[], transcript? }`

### Copy Agent（爆款文案）
- Input: vision summary, brand_profile, platform, goal
- Output: `{ variants: [{ hook, body, cta, tags[], title }] }` × 3–5
- 模板：痛点型 | 对比型 | 清单型 | 故事型 | 测评型（RAG 或硬编码 starter）

### Edit Director Agent
- Input: vision + copy + asset duration
- Output: `{ timeline: [{ start, end, subtitle, effect }], bgm?, cover_text }`

### Compliance Agent
- Input: copy + subtitles
- Output: `{ passed, flags: [{ word, reason, suggestion }] }`

### Publish Agent（Phase 1 仅 export）
- Input: approved creative + platform
- Output: `{ export_pack_url, formatted_metadata }`

## 前端页面（Phase 1）

1. **Login / Org 选择**
2. **Workspace 列表**（代运营多客户看板）
3. **Campaign 创建向导**（上传 → 选平台/目标 → 运行）
4. **Task 进度页**（CEO 步骤实时状态）
5. **Creative 预览页**（视频播放器 + 文案 tab + 改文案 + 重新渲染）
6. **Review 队列**（内部审核）
7. **Client Portal**（`/portal/[token]` — 极简：预览 + pass/reject + comment）
8. **Export 页**（下载成片 + 文案包）

## 4 个月里程碑（计划需按周拆解）

| 月 | 交付 |
|----|------|
| M1 | Monorepo scaffold, DB schema, Auth, Workspace, 上传 |
| M2 | CEO Orchestrator + Copy Agent + Task 状态机 + 基础 UI |
| M3 | FFmpeg Worker + Creative 预览 + 内部审核流 |
| M4 | Client Portal + Export + 稳定/限流/错误处理 + 1 个代运营试点 |

## 成本与安全 guardrails（计划必须包含）

- LLM 调用统一 gateway，每 Task 预算上限（如 S$0.50）
- CEO retry 上限 2 次
- 预览 720p，export 1080p
- 长视频先 ASR 再文本规划，禁止全量 4K 喂 vision
- Client Portal token 过期 + 单 creative  scope
- 素材路径按 workspace_id 隔离

## 计划输出格式要求

请按以下结构输出计划，**不要直接写代码**，等计划确认后再 scaffold：

1. **Executive Summary**（3–5 句）
2. **Architecture Decisions**（ADR 列表，含为何选 Drizzle/Prisma、为何不用 Remotion）
3. **Database Schema**（完整表定义 + 关系）
4. **API Spec**（每个 endpoint 的方法、auth、body、response）
5. **Agent Prompts & Schemas**（每个 Agent 的 system prompt 要点 + JSON schema）
6. **FFmpeg Pipeline Spec**（输入 JSON → ffmpeg 命令模板）
7. **Frontend Routes & Components**（页面树 + 关键组件）
8. **Week-by-Week Task Breakdown**（16 周，每周 3–5 个可交付项）
9. **Risk Register**（至少 5 条 + 缓解措施）
10. **Phase 1.5 / Phase 2 Backlog**（计费、自动发布、A/B、中国平台）

## 成功标准（Definition of Done）

- [ ] 本地 `pnpm dev` 可跑通 web，`pnpm worker` 可消费队列
- [ ] 上传测试视频 → CEO 流水线 → 9:16 成片 + 3 文案 → 内部审核 → export
- [ ] Client Portal magic link 审片可用
- [ ] 2 个 Workspace 数据完全隔离（集成测试）
- [ ] `.cursor/rules` 已写入多租户与 API 约定
- [ ] README 含 env 变量说明与本地启动步骤

---PLAN END---

## 使用方式

1. **Plan 模式**：粘贴 `---PLAN START---` 到 `---PLAN END---` 全文 → 审阅计划 → 确认后切 Agent 执行
2. **Agent 模式（跳过 Plan）**：在 prompt 末尾加一句：`计划已确认，请从 M1 W1 开始 scaffold monorepo。`
3. **迭代 Plan**：在 prompt 末尾追加你的偏好，例如：
   - `首发平台只做小红书 + TikTok`
   - `DB 用 Drizzle，不用 Prisma`
   - `LLM 主力用 Claude，文案 fallback DeepSeek`
