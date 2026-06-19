export type Locale = "en" | "zh" | "ms";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "ms", label: "Bahasa Melayu" },
];

export const DEFAULT_LOCALE: Locale = "zh";

/** Campaign goal values stored in DB → translation key */
export const CAMPAIGN_GOAL_OPTIONS = [
  { value: "种草", key: "goal.seeding" },
  { value: "带货", key: "goal.sales" },
  { value: "涨粉", key: "goal.followers" },
  { value: "品牌曝光", key: "goal.brand" },
] as const;

const en = {
  "lang.en": "English",
  "lang.zh": "中文",
  "lang.ms": "Bahasa Melayu",

  "nav.back": "Back",
  "nav.home": "Home",
  "nav.logout": "Log out",

  "auth.email": "Email",
  "auth.password": "Password",
  "auth.signIn": "Sign in",
  "auth.signUp": "Sign up",
  "auth.signInLink": "Already have an account? Sign in",
  "auth.signUpLink": "Need an account? Sign up",
  "auth.checkEmail": "Check your email to confirm signup.",

  "workspaces.title": "Workspaces",
  "workspaces.subtitle": "Manage brands and client accounts",
  "workspaces.new": "New Workspace",
  "workspaces.namePlaceholder": "Workspace name",
  "workspaces.create": "Create",
  "workspaces.cancel": "Cancel",
  "workspaces.loading": "Loading...",
  "workspaces.empty": "No workspaces yet. Create one to get started.",
  "workspaces.role": "Role: {role}",

  "campaigns.title": "Campaigns",
  "campaigns.new": "New Campaign",
  "campaigns.empty": "No campaigns yet.",
  "campaigns.delete": "Delete",
  "campaigns.deleting": "Deleting…",
  "campaigns.deleteConfirm": 'Delete "{name}"? This cannot be undone.',
  "campaigns.deleteCampaign": "Delete Campaign",
  "campaigns.deleteCampaignConfirm": "Delete this campaign? This cannot be undone.",

  "campaign.new.title": "New Campaign",
  "campaign.name": "Campaign name",
  "campaign.goal": "Goal",
  "campaign.platforms": "Platforms",
  "campaign.upload": "Upload video or images",
  "campaign.uploadHint":
    "Upload your own product photos or raw footage — not finished ads from other brands. We will generate a new short video and ad copy.",
  "campaign.uploadOwnMaterial":
    "Best results: 1 short video (≤15s) or 3+ product images. Avoid re-uploading competitor videos.",
  "campaign.uploadRiskHigh":
    "This file looks like a finished social ad (vertical clip with existing audio/subtitles). Upload raw product footage or photos for better results.",
  "campaign.uploadRiskMedium":
    "This file may be an exported short video. Raw footage or product images work better.",
  "campaign.continueAnyway": "Continue anyway",
  "campaign.submit": "Create & Run EmberOS",
  "campaign.creating": "Creating...",

  "goal.seeding": "Seeding / Discovery",
  "goal.sales": "Sales / Conversion",
  "goal.followers": "Grow followers",
  "goal.brand": "Brand awareness",

  "campaign.detail.taskProgress": "Task Progress",
  "campaign.detail.viewCreative": "View Creative",
  "campaign.detail.run": "Run CEO",
  "campaign.detail.rerun": "Re-run CEO",
  "campaign.detail.running": "Starting…",

  "pipeline.title": "EmberOS Pipeline",
  "pipeline.complete": "Pipeline complete",
  "pipeline.failed": "Pipeline failed",
  "pipeline.starting": "Starting…",
  "pipeline.renderHint": "Usually 3–8 minutes. Video preview unlocks after render completes.",
  "pipeline.viewCreative": "View Creative",
  "pipeline.viewCreativeWait": "View Creative (rendering…)",
  "pipeline.reviewQueue": "Review Queue",

  "step.parse_intent": "Parse intent",
  "step.strategy_plan": "Strategy",
  "step.ceo_plan": "CEO planning",
  "step.vision_analyze": "Vision analysis",
  "step.content_classify": "Content type & preset",
  "step.hook_generate": "Hook generation",
  "step.copy_generate": "Copy generation",
  "step.edit_director_plan": "Edit plan",
  "step.ffmpeg_render": "Video render",
  "step.compliance_check": "Compliance check",
  "step.marketing_score": "Marketing score",
  "step.human_review": "Ready for review",

  "creative.title": "Creative Preview",
  "creative.rendering": "Video rendering...",
  "creative.editCopy": "Edit copy",
  "creative.submitReview": "Submit review",
  "creative.export": "Export",

  "export.title": "Export pack",
  "export.subtitle": "Download ZIP with 1080p video, cover, and platform copy.",
  "export.generate": "Generate export pack",
  "export.working": "Working…",
  "export.download": "Download ZIP",
  "export.idle": "Ready to generate your export pack.",
  "export.waitPreview": "Waiting for preview render to finish (usually 3–8 min).",
  "export.needFinal": "Click generate — we will render 1080p first (about 5–15 min).",
  "export.finalRendering": "Rendering 1080p final video… usually 5–15 minutes.",
  "export.packing": "Packaging ZIP… usually under 2 minutes.",
  "export.ready": "Export pack is ready.",
  "export.needApproval": "Complete review before export.",
  "export.timeout": "Export timed out. Check that the worker and Redis are running, then try again.",
  "export.failed": "Export failed. Ensure Worker + Redis are running, then click Generate again.",
  "export.timingHint":
    "Typical total: 5–15 min if 1080p is not ready yet, then ~1–2 min for ZIP. Requires worker + Redis.",
  "export.stepPreview": "720p preview ready",
  "export.stepFinal": "1080p final video ready",
  "export.stepZip": "ZIP export pack ready",
  "creative.save": "Save",
  "creative.submitted": "Submitted for internal review",
  "creative.rerunHint": "Generate a new video with the latest fixes",
  "creative.field.hook": "Hook",
  "creative.field.body": "Body",
  "creative.field.cta": "CTA",
  "creative.field.title": "Title",

  "status.draft": "Draft",
  "status.processing": "Processing",
  "status.pending_internal_review": "Pending internal review",
  "status.pending_client_review": "Pending client review",
  "status.approved": "Approved",
  "status.export_ready": "Export ready",
  "status.failed": "Failed",
  "status.exported": "Exported",
  "status.preview_rendering": "Preview rendering",
  "status.preview_ready": "Preview ready",
  "status.final_rendering": "Final rendering",
  "status.final_ready": "Final ready",
  "status.queued": "Queued",
  "status.running": "Running",
  "status.completed": "Completed",
  "status.pending": "Pending",
  "status.skipped": "Skipped",
  "status.compliance_failed": "Compliance failed",

  "error.generic": "Something went wrong",
  "error.workspaceNotFound": "Workspace not found",
  "error.createCampaign": "Failed to create campaign",
  "error.deleteCampaign": "Failed to delete campaign",
  "error.runCampaign": "Failed to start EmberOS",
} as const;

const zh: Record<keyof typeof en, string> = {
  "lang.en": "English",
  "lang.zh": "中文",
  "lang.ms": "Bahasa Melayu",

  "nav.back": "返回",
  "nav.home": "首页",
  "nav.logout": "退出登录",

  "auth.email": "邮箱",
  "auth.password": "密码",
  "auth.signIn": "登录",
  "auth.signUp": "注册",
  "auth.signInLink": "已有账号？登录",
  "auth.signUpLink": "没有账号？注册",
  "auth.checkEmail": "请查收邮件完成注册确认。",

  "workspaces.title": "工作区",
  "workspaces.subtitle": "管理品牌与客户账户",
  "workspaces.new": "新建工作区",
  "workspaces.namePlaceholder": "工作区名称",
  "workspaces.create": "创建",
  "workspaces.cancel": "取消",
  "workspaces.loading": "加载中...",
  "workspaces.empty": "还没有工作区，先创建一个吧。",
  "workspaces.role": "角色：{role}",

  "campaigns.title": "营销活动",
  "campaigns.new": "新建活动",
  "campaigns.empty": "还没有活动。",
  "campaigns.delete": "删除",
  "campaigns.deleting": "删除中…",
  "campaigns.deleteConfirm": "确定删除「{name}」？此操作无法撤销。",
  "campaigns.deleteCampaign": "删除活动",
  "campaigns.deleteCampaignConfirm": "确定删除此活动？此操作无法撤销。",

  "campaign.new.title": "新建活动",
  "campaign.name": "活动名称",
  "campaign.goal": "营销目标",
  "campaign.platforms": "发布平台",
  "campaign.upload": "上传视频或图片",
  "campaign.uploadHint":
    "请上传您自己的产品图或原始素材，不要上传他人的成品广告。系统将为您生成新的短视频与广告文案。",
  "campaign.uploadOwnMaterial":
    "建议：1 条短视频（≤15 秒）或 3 张以上产品图。请勿上传竞品/爆款成片。",
  "campaign.uploadRiskHigh":
    "该文件疑似成品短视频广告（竖屏、带配音/字幕特征）。请改传原始素材或产品图，生成效果会更好。",
  "campaign.uploadRiskMedium":
    "该文件可能是导出的短视频。建议上传未剪辑的原片或产品照片。",
  "campaign.continueAnyway": "仍要继续运行",
  "campaign.submit": "创建并运行 EmberOS",
  "campaign.creating": "创建中...",

  "goal.seeding": "种草",
  "goal.sales": "带货",
  "goal.followers": "涨粉",
  "goal.brand": "品牌曝光",

  "campaign.detail.taskProgress": "任务进度",
  "campaign.detail.viewCreative": "查看成片",
  "campaign.detail.run": "运行 CEO",
  "campaign.detail.rerun": "重新运行 CEO",
  "campaign.detail.running": "启动中…",

  "pipeline.title": "EmberOS 流水线",
  "pipeline.complete": "流水线已完成",
  "pipeline.failed": "流水线失败",
  "pipeline.starting": "启动中…",
  "pipeline.renderHint": "通常需 3–8 分钟。渲染完成后可预览视频。",
  "pipeline.viewCreative": "查看成片",
  "pipeline.viewCreativeWait": "查看成片（渲染中…）",
  "pipeline.reviewQueue": "审核队列",

  "step.parse_intent": "解析意图",
  "step.strategy_plan": "营销策略",
  "step.ceo_plan": "CEO 规划",
  "step.vision_analyze": "视觉分析",
  "step.content_classify": "内容识别与预设",
  "step.hook_generate": "钩子生成",
  "step.copy_generate": "文案生成",
  "step.edit_director_plan": "剪辑方案",
  "step.ffmpeg_render": "视频渲染",
  "step.compliance_check": "合规检查",
  "step.marketing_score": "营销评分",
  "step.human_review": "待审核",

  "creative.title": "成片预览",
  "creative.rendering": "视频渲染中...",
  "creative.editCopy": "编辑文案",
  "creative.submitReview": "提交审核",
  "creative.export": "导出",

  "export.title": "导出成片包",
  "export.subtitle": "下载 ZIP：含 1080p 视频、封面、各平台文案。",
  "export.generate": "生成导出包",
  "export.working": "处理中…",
  "export.download": "下载 ZIP",
  "export.idle": "可以开始生成导出包。",
  "export.waitPreview": "预览视频还在渲染，通常需 3–8 分钟。",
  "export.needFinal": "点击生成后，会先渲染 1080p 成片（约 5–15 分钟）。",
  "export.finalRendering": "正在渲染 1080p 成片… 通常 5–15 分钟。",
  "export.packing": "正在打包 ZIP… 通常 1–2 分钟内完成。",
  "export.ready": "导出包已就绪。",
  "export.needApproval": "请先完成审核再导出。",
  "export.timeout": "导出超时。请确认 Worker 和 Redis 已启动，然后重试。",
  "export.failed": "导出失败。请确认 Worker + Redis 在运行，然后再次点击生成。",
  "export.timingHint": "若 1080p 未就绪，总计约 5–15 分钟；ZIP 打包约 1–2 分钟。需 Worker + Redis 运行。",
  "export.stepPreview": "720p 预览已就绪",
  "export.stepFinal": "1080p 成片已就绪",
  "export.stepZip": "ZIP 导出包已就绪",
  "creative.save": "保存",
  "creative.submitted": "已提交内部审核",
  "creative.rerunHint": "用最新逻辑重新生成视频与文案",
  "creative.field.hook": "开场钩子",
  "creative.field.body": "正文",
  "creative.field.cta": "行动号召",
  "creative.field.title": "标题",

  "status.draft": "草稿",
  "status.processing": "处理中",
  "status.pending_internal_review": "待内部审核",
  "status.pending_client_review": "待客户审核",
  "status.approved": "已通过",
  "status.export_ready": "可导出",
  "status.failed": "失败",
  "status.exported": "已导出",
  "status.preview_rendering": "预览渲染中",
  "status.preview_ready": "预览就绪",
  "status.final_rendering": "成片渲染中",
  "status.final_ready": "1080p 就绪",
  "status.queued": "排队中",
  "status.running": "运行中",
  "status.completed": "已完成",
  "status.pending": "待处理",
  "status.skipped": "已跳过",
  "status.compliance_failed": "合规未通过",

  "error.generic": "出错了",
  "error.workspaceNotFound": "找不到工作区",
  "error.createCampaign": "创建活动失败",
  "error.deleteCampaign": "删除活动失败",
  "error.runCampaign": "启动 EmberOS 失败",
};

const ms: Record<keyof typeof en, string> = {
  "lang.en": "English",
  "lang.zh": "中文",
  "lang.ms": "Bahasa Melayu",

  "nav.back": "Kembali",
  "nav.home": "Laman utama",
  "nav.logout": "Log keluar",

  "auth.email": "E-mel",
  "auth.password": "Kata laluan",
  "auth.signIn": "Log masuk",
  "auth.signUp": "Daftar",
  "auth.signInLink": "Sudah ada akaun? Log masuk",
  "auth.signUpLink": "Tiada akaun? Daftar",
  "auth.checkEmail": "Semak e-mel anda untuk mengesahkan pendaftaran.",

  "workspaces.title": "Ruang Kerja",
  "workspaces.subtitle": "Urus jenama dan akaun pelanggan",
  "workspaces.new": "Ruang Kerja Baharu",
  "workspaces.namePlaceholder": "Nama ruang kerja",
  "workspaces.create": "Cipta",
  "workspaces.cancel": "Batal",
  "workspaces.loading": "Memuatkan...",
  "workspaces.empty": "Tiada ruang kerja lagi. Cipta satu untuk bermula.",
  "workspaces.role": "Peranan: {role}",

  "campaigns.title": "Kempen",
  "campaigns.new": "Kempen Baharu",
  "campaigns.empty": "Tiada kempen lagi.",
  "campaigns.delete": "Padam",
  "campaigns.deleting": "Memadam…",
  "campaigns.deleteConfirm": 'Padam "{name}"? Tindakan ini tidak boleh dibatalkan.',
  "campaigns.deleteCampaign": "Padam Kempen",
  "campaigns.deleteCampaignConfirm": "Padam kempen ini? Tindakan ini tidak boleh dibatalkan.",

  "campaign.new.title": "Kempen Baharu",
  "campaign.name": "Nama kempen",
  "campaign.goal": "Matlamat",
  "campaign.platforms": "Platform",
  "campaign.upload": "Muat naik video atau imej",
  "campaign.uploadHint":
    "Muat naik foto produk atau rakaman mentah anda sendiri — bukan iklan siap dari jenama lain. Kami akan jana video pendek dan salinan iklan baharu.",
  "campaign.uploadOwnMaterial":
    "Terbaik: 1 video pendek (≤15s) atau 3+ imej produk. Elakkan memuat naik semula video pesaing.",
  "campaign.uploadRiskHigh":
    "Fail ini kelihatan seperti iklan sosial siap (klip menegak dengan audio/sari kata). Muat naik rakaman mentah atau foto produk.",
  "campaign.uploadRiskMedium":
    "Fail ini mungkin video pendek yang dieksport. Rakaman mentah atau imej produk memberi hasil lebih baik.",
  "campaign.continueAnyway": "Teruskan juga",
  "campaign.submit": "Cipta & Jalankan EmberOS",
  "campaign.creating": "Mencipta...",

  "goal.seeding": "Penemuan / Seeding",
  "goal.sales": "Jualan / Penukaran",
  "goal.followers": "Tambah pengikut",
  "goal.brand": "Kesedaran jenama",

  "campaign.detail.taskProgress": "Kemajuan Tugas",
  "campaign.detail.viewCreative": "Lihat Kreatif",
  "campaign.detail.run": "Jalankan CEO",
  "campaign.detail.rerun": "Jalankan semula CEO",
  "campaign.detail.running": "Memulakan…",

  "pipeline.title": "Talian Paip EmberOS",
  "pipeline.complete": "Talian paip selesai",
  "pipeline.failed": "Talian paip gagal",
  "pipeline.starting": "Memulakan…",
  "pipeline.renderHint": "Biasanya 3–8 minit. Pratonton video dibuka selepas render selesai.",
  "pipeline.viewCreative": "Lihat Kreatif",
  "pipeline.viewCreativeWait": "Lihat Kreatif (merender…)",
  "pipeline.reviewQueue": "Barisan Semakan",

  "step.parse_intent": "Tafsir niat",
  "step.strategy_plan": "Strategi",
  "step.ceo_plan": "Perancangan CEO",
  "step.vision_analyze": "Analisis visual",
  "step.content_classify": "Jenis kandungan & pratetap",
  "step.hook_generate": "Penjanaan hook",
  "step.copy_generate": "Penjanaan salinan",
  "step.edit_director_plan": "Pelan suntingan",
  "step.ffmpeg_render": "Render video",
  "step.compliance_check": "Semakan pematuhan",
  "step.marketing_score": "Skor pemasaran",
  "step.human_review": "Sedia untuk semakan",

  "creative.title": "Pratonton Kreatif",
  "creative.rendering": "Merender video...",
  "creative.editCopy": "Edit salinan",
  "creative.submitReview": "Hantar semakan",
  "creative.export": "Eksport",

  "export.title": "Pek eksport",
  "export.subtitle": "Muat turun ZIP dengan video 1080p, kulit, dan salinan platform.",
  "export.generate": "Jana pek eksport",
  "export.working": "Sedang diproses…",
  "export.download": "Muat turun ZIP",
  "export.idle": "Sedia untuk menjana pek eksport.",
  "export.waitPreview": "Menunggu render pratonton (biasanya 3–8 min).",
  "export.needFinal": "Klik jana — kami akan render 1080p dahulu (kira-kira 5–15 min).",
  "export.finalRendering": "Merender video akhir 1080p… biasanya 5–15 minit.",
  "export.packing": "Membungkus ZIP… biasanya kurang 2 minit.",
  "export.ready": "Pek eksport sedia.",
  "export.needApproval": "Lengkapkan semakan sebelum eksport.",
  "export.timeout": "Eksport tamat masa. Pastikan worker dan Redis berjalan, kemudian cuba lagi.",
  "export.failed": "Eksport gagal. Pastikan Worker + Redis berjalan, kemudian klik Jana semula.",
  "export.timingHint":
    "Jumlah biasa: 5–15 min jika 1080p belum sedia, kemudian ~1–2 min untuk ZIP. Perlukan worker + Redis.",
  "export.stepPreview": "Pratonton 720p sedia",
  "export.stepFinal": "Video akhir 1080p sedia",
  "export.stepZip": "Pek ZIP eksport sedia",
  "creative.save": "Simpan",
  "creative.submitted": "Dihantar untuk semakan dalaman",
  "creative.rerunHint": "Jana semula video dengan kemas kini terkini",
  "creative.field.hook": "Hook",
  "creative.field.body": "Isi",
  "creative.field.cta": "CTA",
  "creative.field.title": "Tajuk",

  "status.draft": "Draf",
  "status.processing": "Memproses",
  "status.pending_internal_review": "Menunggu semakan dalaman",
  "status.pending_client_review": "Menunggu semakan pelanggan",
  "status.approved": "Diluluskan",
  "status.export_ready": "Sedia eksport",
  "status.failed": "Gagal",
  "status.exported": "Dieksport",
  "status.preview_rendering": "Render pratonton",
  "status.preview_ready": "Pratonton sedia",
  "status.final_rendering": "Render akhir",
  "status.final_ready": "1080p sedia",
  "status.queued": "Beratur",
  "status.running": "Berjalan",
  "status.completed": "Selesai",
  "status.pending": "Menunggu",
  "status.skipped": "Dilangkau",
  "status.compliance_failed": "Pematuhan gagal",

  "error.generic": "Sesuatu tidak kena",
  "error.workspaceNotFound": "Ruang kerja tidak dijumpai",
  "error.createCampaign": "Gagal mencipta kempen",
  "error.deleteCampaign": "Gagal memadam kempen",
  "error.runCampaign": "Gagal memulakan EmberOS",
};

export type TranslationKey = keyof typeof en;

export const messages: Record<Locale, Record<TranslationKey, string>> = { en, zh, ms };

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  let text = messages[locale]?.[key] ?? messages.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "zh" || value === "ms";
}

export function statusTranslationKey(status: string): TranslationKey | null {
  const key = `status.${status}` as TranslationKey;
  return key in en ? key : null;
}
