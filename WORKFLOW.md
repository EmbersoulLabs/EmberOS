# AIGC CEO Marketing — 分段式 Workflow（产品 · 用户操作）

> **开发流程**请看 [DEVELOPMENT_WORKFLOW.md](./DEVELOPMENT_WORKFLOW.md)（Dev 1–6 · Plan → Scaffold → Pipeline → UI → 联调 → 部署）

将整个**产品使用**流程拆为 **6 大段、24 小步**。每段有明确输入、输出、负责角色与系统状态变化。

> 配套文档：[README.md](./README.md) · [PLAN_PROMPT.md](./PLAN_PROMPT.md)

---

## 总览：六段流水线

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  段 1    │ → │  段 2    │ → │  段 3    │ → │  段 4    │ → │  段 5    │ → │  段 6    │
│ 准备与   │   │ 素材     │   │ CEO      │   │ 预览与   │   │ 审核     │   │ 交付与   │
│ 立项     │   │ 接入     │   │ 自动生产 │   │ 人工调优 │   │ 把关     │   │ 发布     │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
  用户操作       用户操作       全自动         人机协作       人机协作       用户/系统
  ~5 min         ~3 min         ~5-10 min      ~5-15 min      ~1-48 h        ~2 min
```

| 段 | 名称 | 主导 | 状态区间 |
|----|------|------|----------|
| **1** | 准备与立项 | 人 | — → `draft` |
| **2** | 素材接入 | 人 + 系统 | `draft` |
| **3** | CEO 自动生产 | 系统 | `draft` → `processing` → `pending_internal_review` |
| **4** | 预览与人工调优 | 人 + 系统 | `pending_internal_review` |
| **5** | 审核把关 | 人 | → `pending_client_review` → `approved` / `rejected` |
| **6** | 交付与发布 | 人 + 系统 | `approved` → `published` |

---

## 段 1：准备与立项

**目标：** 在正确的 Workspace 下创建 Campaign，明确「为谁、在哪发、要达到什么」。

### 步骤

| 步 | 动作 | 操作者 | 输入 | 输出 |
|----|------|--------|------|------|
| 1.1 | 登录 / 选择 Organization | Admin / Operator | 账号 | 进入控制台 |
| 1.2 | 选择或创建 Workspace | Admin | 客户/品牌信息 | `workspace_id` |
| 1.3 | 新建 Campaign | Operator | 活动名称 | `campaign_id`，状态 `draft` |
| 1.4 | 填写营销目标 | Operator | 涨粉 / 带货 / 种草 / 品牌 | `goal` |
| 1.5 | 选择目标平台 | Operator | 抖音 / 小红书 / TikTok 等 | `platforms[]` |
| 1.6 | （可选）配置品牌档案 | Admin | 调性、禁用词、人群、CTA | `brand_profile` |

### 段末检查清单

- [ ] Workspace 是否选对（代运营：是否为客户 A 而非 B）
- [ ] 平台与素材类型是否匹配（竖版视频 → 抖音/小红书）
- [ ] 品牌禁用词是否已录入

### 系统状态

```
Campaign.status = draft
Task = 尚未创建
```

---

## 段 2：素材接入

**目标：** 把原始视频/图片安全上传，并完成基础校验。

### 步骤

| 步 | 动作 | 操作者 | 输入 | 输出 |
|----|------|--------|------|------|
| 2.1 | 请求上传凭证 | Operator | 文件名、类型、大小 | presigned URL |
| 2.2 | 上传文件到 OSS | 浏览器 | 本地 mp4/jpg 等 | `asset.url` |
| 2.3 | 系统校验 | 系统 | 格式、大小、时长 | 通过 / 报错 |
| 2.4 | 写入 Asset 记录 | 系统 | — | `assets` 表一行 |
| 2.5 | （可选）添加参考爆款链接 | Operator | URL / 文本 | `reference` |
| 2.6 | 确认素材列表 | Operator | 预览缩略图 | 准备运行 CEO |

### 素材要求（MVP）

| 类型 | 格式 | 建议 |
|------|------|------|
| 视频 | mp4, mov | ≤5min，竖版优先 |
| 图片 | jpg, png | ≥1 张，产品图清晰 |

### 段末检查清单

- [ ] 至少 1 个视频或 3 张图片
- [ ] 上传完成，缩略图/预览正常
- [ ] 文件路径含 `workspace_id`（租户隔离）

### 系统状态

```
Campaign.status = draft
Assets[] = 已关联
Task = 尚未创建
```

---

## 段 3：CEO 自动生产

**目标：** 零人工干预下，产出成片 + 多版爆款文案 + 封面。本段全自动。

### 子段 3A：启动与规划

| 步 | 动作 | 操作者 | 说明 |
|----|------|--------|------|
| 3.1 | 点击「运行 CEO」 | Operator | `POST /campaigns/:id/run` |
| 3.2 | 创建 Task | 系统 | 状态 `processing` |
| 3.3 | 任务入队 | 系统 | BullMQ job |
| 3.4 | parse_intent | CEO | 解析 goal + platforms + assets |
| 3.5 | ceo_plan | CEO | 生成 TaskGraph JSON |

### 子段 3B：理解素材（可并行）

| 步 | Agent | 输入 | 输出 |
|----|-------|------|------|
| 3.6 | **Vision** | 抽帧 / 短视频 | subjects, scenes, hooks[], transcript? |
| 3.7 | **Copy**（初稿） | 元数据 + brand_profile | 文案变体草稿 |

> 长视频：先 **ASR 转写**，再文本分析，不全量 4K 喂 Vision。

### 子段 3C：文案定稿

| 步 | Agent | 输入 | 输出 |
|----|-------|------|------|
| 3.8 | **Copy**（定稿） | Vision 摘要 + 平台 + 模板 | 3–5 版：title, hook, body, cta, tags |
| 3.9 | 模板选择 | CEO 决策 | 痛点 / 对比 / 清单 / 故事 / 测评 |

**爆款收缩结构（每版）：**

```
[0-3s 钩子] → [≤3 个卖点] → [CTA]
```

### 子段 3D：剪辑与渲染

| 步 | Agent / Worker | 输入 | 输出 |
|----|----------------|------|------|
| 3.10 | **Edit Director** | vision + copy + 时长 | timeline[], cover_text |
| 3.11 | **FFmpeg Worker** | timeline JSON | 9:16 mp4（预览 720p） |
| 3.12 | 封面生成 | cover_text + 关键帧 | cover.jpg |

### 子段 3E：质检

| 步 | Agent | 输入 | 输出 |
|----|-------|------|------|
| 3.13 | **Compliance** | 文案 + 字幕 | passed / flags[] |
| 3.14 | CEO 质检评分 | 全部产出 | score；不通过则重试 |
| 3.15 | 重试（若需要） | — | 重跑 Copy 或 Edit，**≤2 次** |
| 3.16 | 写入 Creative | — | `creatives` 表；Task 完成 |

### 段末产出

| 产出物 | 数量 |
|--------|------|
| 竖版成片 | 1 条 |
| 文案变体 | 3–5 套 |
| 封面 | 1 张 |

### 系统状态

```
Task.status: processing → completed
Creative.status: pending_internal_review
Campaign 可进入段 4
```

### 段 3 流程图

```
[运行 CEO]
    ↓
parse_intent → ceo_plan
    ↓
┌───────────────┬───────────────┐
│ Vision 分析   │ Copy 生成     │
└───────┬───────┴───────┬───────┘
        └───────┬───────┘
                ↓
        Edit Director（分镜）
                ↓
        FFmpeg 渲染 + 封面
                ↓
        Compliance 合规
                ↓
        CEO 质检 ──失败──→ 重试 Copy/Edit（≤2）
                ↓ 通过
        产出 Creative → pending_internal_review
```

---

## 段 4：预览与人工调优

**目标：** 运营在自动产出基础上做最小必要修改，避免整链重跑。

### 步骤

| 步 | 动作 | 操作者 | 说明 |
|----|------|--------|------|
| 4.1 | 打开 Creative 预览页 | Operator / Editor | 播放成片 |
| 4.2 | 切换文案版本 | Operator | Tab 切换 3–5 版 |
| 4.3 | 选定主文案版本 | Operator | 标记 `primary_variant` |
| 4.4 |  inline 编辑文案 | Editor | 改 title / body / tags |
| 4.5 | 保存文案 | Editor | `PATCH /creatives/:id/copy` |
| 4.6 | （可选）仅重跑 Copy | Operator | 不碰视频 |
| 4.7 | （可选）仅重跑剪辑 | Operator | 字幕/节奏问题 |
| 4.8 | 确认可提交审核 | Operator | 段末检查 |

### 何时局部重跑 vs 全文案手改

| 情况 | 建议 |
|------|------|
| 个别用词、标签 | 手改文案（段 4.4） |
| 整体风格不对 | 重跑 Copy（段 4.6） |
| 字幕时间轴、节奏 | 重跑 Edit（段 4.7） |
| 画面裁切问题 | 重跑 Edit |

### 段末检查清单

- [ ] 成片可播放、比例正确（9:16）
- [ ] 字幕无错别字、无违规词
- [ ] 主文案版本已选定
- [ ] 封面与标题一致

### 系统状态

```
Creative.status = pending_internal_review（仍未提交审核）
```

---

## 段 5：审核把关

**目标：** 内部 QC 通过；代运营场景下客户签字确认。

### 子段 5A：内部审核（所有模式）

| 步 | 动作 | 操作者 | 说明 |
|----|------|--------|------|
| 5.1 | 提交内部审核 | Operator | `submit-review` |
| 5.2 | Reviewer 打开审核队列 | Reviewer | 看待审列表 |
| 5.3 | 对比预览 | Reviewer | 原素材 vs 成片（若有） |
| 5.4 | 决策 | Reviewer | **pass** 或 **reject** + comment |
| 5.5a | 若 reject | — | 回到 **段 4**，状态 `rejected` |
| 5.5b | 若 pass | — | 进入 5B 或 5C |

### 子段 5B：客户审核（仅代运营）

| 步 | 动作 | 操作者 | 说明 |
|----|------|--------|------|
| 5.6 | 生成 Magic Link | Operator | `POST /workspaces/:id/invites` |
| 5.7 | 发送给客户 | Operator | 微信 / 邮件 |
| 5.8 | 客户打开 Portal | Client Viewer | 无需登录，`/portal/[token]` |
| 5.9 | 客户预览 + 决策 | Client Viewer | pass / reject + comment |
| 5.10a | 客户 reject | — | 回到 **段 4**，带修改意见 |
| 5.10b | 客户 pass | — | `approved` |

### 子段 5C：自用 / SaaS（可跳过客户审）

| 模式 | 5A 通过后 |
|------|-----------|
| 自用 | 直接 `approved` |
| SaaS | 可配置：跳过或保留内部审 |
| 代运营 | 必须走 5B |

### 审核状态迁移

```
pending_internal_review
  ├─ reject → rejected → 回到段 4
  └─ pass → pending_client_review（代运营）
              ├─ reject → rejected → 回到段 4
              └─ pass → approved
```

### 段末检查清单

- [ ] 内部审核记录已存档
- [ ] 代运营：客户已 pass 或有书面驳回意见
- [ ] `approved` 的 Creative 不可再自动改文案（需新版本）

---

## 段 6：交付与发布

**目标：** 按平台规格打包，导出或自动发布。

### 子段 6A：平台适配

| 步 | Agent | 输入 | 输出 |
|----|-------|------|------|
| 6.1 | **Publish / Adapt** | approved creative + platform | 格式化 metadata |
| 6.2 | 抖音适配 | — | 标题 ≤30 字、话题标签 |
| 6.3 | 小红书适配 | — | emoji 标题、分段正文 |
| 6.4 | TikTok 适配 | — | hashtags、时长校验 |

### 子段 6B：导出（Phase 1）

| 步 | 动作 | 操作者 | 输出 |
|----|------|--------|------|
| 6.5 | 触发导出 | Publisher | `POST /creatives/:id/export` |
| 6.6 | 渲染高清（可选） | Worker | 1080p 成片 |
| 6.7 | 打包 ZIP | 系统 | 成片 + 封面 + 文案.txt + 标签 |
| 6.8 | 下载 | Publisher | 本地保存 |
| 6.9 | 手动上传平台 | Publisher | 抖音 / 小红书 / TikTok App |

### 子段 6C：自动发布（Phase 1.5+）

| 步 | 动作 | 说明 |
|----|------|------|
| 6.10 | 绑定平台 OAuth | 账号归属 Workspace |
| 6.11 | 创建 PublishJob | 即时或 `scheduled` |
| 6.12 | 调用平台 API | 回写 `external_post_id` |
| 6.13 | 状态更新 | `published` / `failed` |

### 段末产出

| 交付物 | 接收方 |
|--------|--------|
| ZIP 包或发布链接 | 运营 / 客户 |
| 发布记录 | `publish_jobs` 表 |

### 系统状态

```
Creative.status: approved → published
Campaign 可归档或复制为新 Campaign
```

---

## 按角色的分段视图

### Operator（运营）

```
段 1 立项 → 段 2 上传 → 段 3 点运行 → 段 4 改稿 → 段 5 提交审核 → 段 6 导出
```

### Reviewer（内部审核）

```
段 5A：5.2 → 5.3 → 5.4（pass/reject）
```

### Client Viewer（甲方客户 · 代运营）

```
段 5B：5.8 → 5.9（仅审片，无其他权限）
```

### Publisher（发布）

```
段 6：6.5 → 6.8 → 6.9（Phase 1 手动发）
```

### 系统（无人值守）

```
段 3 全文：3.1 → … → 3.16
段 6 部分：6.1–6.7、6.10–6.13（Phase 1.5+）
```

---

## 异常与回退矩阵

| 发生在 | 现象 | 回退到 | 操作 |
|--------|------|--------|------|
| 段 2 | 上传失败 | 段 2.1 | 重传 |
| 段 3 | LLM 超时 | 段 3.1 | 重试 Task（CEO 计数） |
| 段 3 | 合规不通过 | 段 3.8 或 3.10 | 自动重跑 Copy/Edit |
| 段 3 | 重试耗尽 | — | `failed`，人工介入 |
| 段 4 | 文案不满意 | 段 4.4 或 4.6 | 手改或重跑 Copy |
| 段 5 | 内部驳回 | 段 4 | 按 comment 修改 |
| 段 5 | 客户驳回 | 段 4 | 按客户意见修改 |
| 段 6 | 发布 API 失败 | 段 6B | 改用手动导出 |

---

## 时间预算（单条 Campaign）

| 段 | 人工时间 | 系统时间 | 累计 |
|----|----------|----------|------|
| 1 立项 | 3–5 min | — | ~5 min |
| 2 上传 | 2–3 min | 1–2 min | ~8 min |
| 3 CEO 生产 | 0 | 5–10 min | ~18 min |
| 4 调优 | 5–15 min | 0–3 min | ~30 min |
| 5 审核 | 0–48 h | — | 视客户 |
| 6 交付 | 2–5 min | 1–2 min | ~35 min（不含等待审核） |

**MVP 目标：** 段 1–4 + 6 在 **30 分钟内** 完成（审核异步）。

---

## 与三种商业模式的段差异

| 段 | 自用 | 代运营 | SaaS |
|----|------|--------|------|
| 1 | 自己的 Workspace | 客户的 Workspace | 租户自建 Workspace |
| 5 | 仅 5A | **5A + 5B 必做** | 5A，5B 可配置 |
| 6 | 导出自用 | 导出到客户账号 | 导出 + 用量扣减 |

---

## 快速索引

- 只想跑通一条片子：**段 1 → 2 → 3 → 4 → 6B**（跳过客户审可自批 5A）
- 代运营标准交付：**段 1 → 2 → 3 → 4 → 5A → 5B → 6**
- 调试 Agent：**段 3** 子段 3A–3E 逐步日志
- 排查审核卡住：**段 5** 状态机 + `reviews` 表
