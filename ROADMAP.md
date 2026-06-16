# 16 周开发路线图（Plan To-dos）

与 Cursor Plan 输出对齐，映射到 [DEVELOPMENT_WORKFLOW.md](./DEVELOPMENT_WORKFLOW.md)。

**图例：** ✅ 代码已有 · 🔄 需联调/验证 · ⬜ 未做或待部署

---

## M1 — 地基（W1–W4）→ Dev 2

| 周 | 任务 | Dev 段 | 状态 | 仓库位置 |
|----|------|--------|------|----------|
| **W1** | pnpm monorepo scaffold（Turbo）、apps/web、apps/worker、packages、.cursor/rules、README env | Dev 2.1 | ✅ | 根目录 `package.json`、`turbo.json`、`pnpm-workspace.yaml` |
| **W2** | Supabase + Drizzle migrations、RLS、Auth、Next.js login skeleton | Dev 2.3–2.4 | ✅ | `packages/db/`、`apps/web/src/app/login/`、`packages/db/sql/rls.sql` |
| **W3** | Org/Workspace CRUD API、workspace 列表 UI、RBAC | Dev 2.6–2.7 | ✅ | `api/workspaces`、`api/organizations`、`app/workspaces` |
| **W4** | Campaign CRUD、presigned upload、ffprobe 元数据 | Dev 2.6 | ✅ | `api/campaigns`、`upload-url`、`confirm`；worker `probeVideo` |

**M1 段末演示：** 登录 → 建 Workspace → 上传 mp4 ✅（代码就绪，需配 `.env` 实测）

---

## M2 — Agent 流水线（W5–W8）→ Dev 3

| 周 | 任务 | Dev 段 | 状态 | 仓库位置 |
|----|------|--------|------|----------|
| **W5–W8** | BullMQ worker、CEO/Vision/Copy agents、task 状态机、进度 UI | Dev 3 | ✅ | `apps/worker/`、`packages/agents/`、`app/.../task/` |

**细分：**

| 子项 | 状态 | 文件 |
|------|------|------|
| BullMQ + Redis | ✅ | `packages/queue/`、`apps/worker/src/index.ts` |
| CEO Orchestrator | ✅ | `packages/agents/src/ceo.ts`、`orchestrator.ts` |
| Vision Agent | ✅ | `packages/agents/src/vision.ts` |
| Copy Agent | ✅ | `packages/agents/src/copy.ts` |
| Task 状态机 + run API | ✅ | `api/campaigns/[id]/run`、`api/tasks/[id]` |
| 进度 UI | ✅ | `TaskProgressContent.tsx` |

**M2 段末演示：** `POST run` → task completed → creative 有数据 🔄（需 Redis + Supabase + OpenAI key 联调）

---

## M3 — 剪辑与审核（W9–W12）→ Dev 3–4

| 周 | 任务 | Dev 段 | 状态 | 仓库位置 |
|----|------|--------|------|----------|
| **W9–W12** | Edit Director、FFmpeg 渲染、compliance、内部审核、错误重试 | Dev 3–4 | ✅ | 见下表 |

| 子项 | 状态 | 文件 |
|------|------|------|
| Edit Director | ✅ | `packages/agents/src/edit.ts` |
| FFmpeg pipeline | ✅ | `apps/worker/src/ffmpeg/pipeline.ts` |
| Compliance Agent | ✅ | `packages/agents/src/compliance.ts` |
| 内部审核流 | ✅ | `api/reviews`、`app/.../reviews` |
| Retry 路径 | ✅ | `packages/agents/src/orchestrator.ts`、`.cursor/rules/agents-pipeline.mdc` |
| Creative 预览 + 改文案 | ✅ | `app/.../creatives/[id]`、`api/creatives/[id]` |

**M3 段末演示：** 浏览器内审核 pass/reject 🔄

---

## M4 — Portal / 硬化 / 部署（W13–W16）→ Dev 4–6

| 周 | 任务 | Dev 段 | 状态 | 仓库位置 |
|----|------|--------|------|----------|
| **W13–W16** | Client Portal、ZIP export、隔离测试、限流、Vercel/Railway 部署 | Dev 4–6 | 🔄 | 见下表 |

| 子项 | 状态 | 文件 |
|------|------|------|
| Client Portal | ✅ | `app/portal/[token]`、`api/portal/[token]` |
| ZIP export | ✅ | `api/creatives/[id]/export`、worker `createExportZip` |
| Workspace 隔离测试 | 🔄 | `tests/workspace-isolation.test.ts`（需跑 `pnpm test`） |
| API 限流 | ⬜ | 待加 middleware |
| Vercel 部署 web | ⬜ | 待配 `vercel.json` / 环境变量 |
| Railway 部署 worker | ⬜ | 待 `infra/docker/Dockerfile.worker` |

**M4 段末演示：** 生产 URL 跑通 1 条 Campaign ⬜

---

## 与 Dev 六段对照

| Plan 里程碑 | 开发 Workflow | 周次 |
|-------------|---------------|------|
| M1 | Dev 2 地基 | W1–W4 |
| M2 | Dev 3 流水线（前半） | W5–W8 |
| M3 | Dev 3–4 流水线 + 审核 | W9–W12 |
| M4 | Dev 4–6 Portal + 联调 + 部署 | W13–W16 |

---

## 当前建议：你在哪、下一步做什么

```
代码 scaffold：约 M1–M3 完成（~75%）
真正缺口：环境配置 + 端到端联调 + M4 部署硬化
```

### 立即做（本周）

1. **配环境** — 复制 `.env.example` → `.env.local`，填 Supabase / Redis / OpenAI
2. **推 DB** — `pnpm db:push`，执行 `packages/db/sql/rls.sql`
3. **本地双进程** — `pnpm dev` + `pnpm worker:dev`
4. **走一条片** — 上传 → run → 看 task 页 → 审核 → export
5. **跑测试** — `pnpm test`（隔离测试）

### 随后做（M4）

6. API rate limit（`LLM_BUDGET_PER_TASK_USD` 已有，加 HTTP 限流）
7. Worker Docker 镜像 + Railway
8. Vercel 部署 + 生产烟雾测试

---

## Cursor Plan To-do 勾选建议

在 Plan 面板可整项勾选：

- [x] M1 W1 — monorepo scaffold
- [x] M1 W2 — Supabase/Drizzle/Auth
- [x] M1 W3 — Workspace/RBAC
- [x] M1 W4 — Campaign/upload/ffprobe
- [x] M2 W5–W8 — worker + agents + task UI（代码完成，联调后勾）
- [x] M3 W9–W12 — FFmpeg + review + retry（代码完成，联调后勾）
- [ ] M4 W13–W16 — Portal/export 已有；**部署 + 限流 + 生产验证** 待做

---

## 每周验收命令（复制即用）

```bash
# 安装
pnpm install

# 数据库
pnpm db:push

# 开发
pnpm dev          # :3000
pnpm worker:dev   # 另开终端

# 检查
pnpm typecheck
pnpm test
pnpm build
```

**人工 E2E 路径：**

```
/login → /workspaces → /w/{slug}/campaigns/new
→ 上传 → /w/{slug}/campaigns/{id} → 运行 CEO
→ /w/{slug}/campaigns/{id}/task → /w/{slug}/creatives/{id}
→ /w/{slug}/reviews → /w/{slug}/creatives/{id}/export
```
