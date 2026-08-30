import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FREE_EXPORT_RESOLUTION } from "../packages/shared/src/billing";
import { AUTO_CLIP } from "../packages/shared/src/render";
import {
  countFinalRenderProgress,
  isCreativeReadyForTaskExport,
  isTaskPackageReadyForFreeExport,
  pickVideoUrlForExport,
} from "../packages/agents/src/task-export";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

delete process.env.REDIS_URL;

const TASK_ID = "f73dc0f1-83d9-457c-91d6-b1073e23e528";
const CAMPAIGN_ID = "eb666a85-b23b-49eb-98a5-341d78ad1c98";
const ORG_ID = "e0a0f708-6e3b-4155-8b5b-d97b4341bb8c";
const WORKSPACE_ID = "4eaa190e-e68b-4fd9-8227-99543f287afd";
const USER_ID = "8df0d5ae-7748-4079-a6bf-0a2358bf9b81";

type Clip = {
  renderStatus: string | null;
  videoUrl: string | null;
  videoExportUrl: string | null;
};

function clip(
  renderStatus: string | null,
  extras?: Partial<Pick<Clip, "videoUrl" | "videoExportUrl">>
): Clip {
  const preview = extras?.videoUrl === undefined ? "ws/c/renders/preview_720p.mp4" : extras.videoUrl;
  const exported =
    extras?.videoExportUrl === undefined
      ? renderStatus === "final_ready"
        ? "ws/c/renders/final_1080p.mp4"
        : null
      : extras.videoExportUrl;
  return { renderStatus, videoUrl: preview, videoExportUrl: exported };
}

function pack(statuses: Array<string | null>, extras?: Array<Partial<Clip> | undefined>): Clip[] {
  return statuses.map((status, index) => clip(status, extras?.[index]));
}

const { requireAuth, getTaskCreatives, setTaskExportRequest, enqueueTaskExport, getDb } = vi.hoisted(
  () => ({
    requireAuth: vi.fn(),
    getTaskCreatives: vi.fn(),
    setTaskExportRequest: vi.fn(),
    enqueueTaskExport: vi.fn(),
    getDb: vi.fn(),
  })
);

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/auth")>(
    "../apps/web/src/lib/auth"
  );
  return { ...actual, requireAuth: () => requireAuth() };
});

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => null),
}));
vi.mock("../apps/web/src/lib/rate-limit.ts", () => ({
  enforceRateLimit: vi.fn(async () => null),
}));

vi.mock("@ceo-agent/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ceo-agent/db")>();
  return {
    ...actual,
    getDb: () => getDb(),
    requireWorkspaceRole: vi.fn(async () => ({ orgId: ORG_ID, workspaceId: WORKSPACE_ID, role: "publisher" })),
  };
});

vi.mock("@/lib/render-queue", () => ({
  enqueueFinalRendersForTask: vi.fn(),
  enqueue2kRendersForTask: vi.fn(),
}));

vi.mock("@ceo-agent/queue", () => ({
  enqueueTaskExport,
}));
vi.mock("../packages/queue/src/index.ts", () => ({
  enqueueTaskExport,
}));

vi.mock("@ceo-agent/agents", async () => {
  const actual = await import("../packages/agents/src/task-export");
  return {
    ...actual,
    getTaskCreatives: (...args: unknown[]) => getTaskCreatives(...args),
    setTaskExportRequest: (...args: unknown[]) => setTaskExportRequest(...args),
  };
});

function exportDb() {
  const task = {
    id: TASK_ID,
    orgId: ORG_ID,
    workspaceId: WORKSPACE_ID,
    campaignId: CAMPAIGN_ID,
    status: "completed",
    stepProgress: {},
  };
  const campaign = {
    id: CAMPAIGN_ID,
    status: "approved",
    platforms: ["tiktok"],
  };
  let selects = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            selects += 1;
            return selects === 1 ? [task] : [campaign];
          }),
        })),
      })),
    })),
  };
}

async function post720pExport() {
  const route = await import("../apps/web/src/app/api/tasks/[id]/export/route");
  return route.POST(
    new Request("http://localhost/api/tasks/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolution: "720p" }),
    }),
    { params: Promise.resolve({ id: TASK_ID }) }
  );
}

describe("VS-EDIT-V1-PROD-CERT-E1 task-export readiness", () => {
  it("treats only preview_ready and final_ready as export-ready", () => {
    expect(isCreativeReadyForTaskExport("preview_ready")).toBe(true);
    expect(isCreativeReadyForTaskExport("final_ready")).toBe(true);
    for (const status of [
      "none",
      "preview_rendering",
      "final_rendering",
      "failed",
      "queued",
      "rendering",
      null,
      undefined,
      "unknown",
    ]) {
      expect(isCreativeReadyForTaskExport(status)).toBe(false);
    }
  });

  it("keeps 720p artifact selection on videoUrl for preview_ready and final_ready", () => {
    const preview = clip("preview_ready");
    const final = clip("final_ready");
    expect(pickVideoUrlForExport(preview, FREE_EXPORT_RESOLUTION)).toBe(preview.videoUrl);
    expect(pickVideoUrlForExport(final, FREE_EXPORT_RESOLUTION)).toBe(final.videoUrl);
    expect(pickVideoUrlForExport(final, "1080p")).toBe(final.videoExportUrl);
  });

  it("Case A — 3 x preview_ready allows 720p export", () => {
    const creatives = pack(["preview_ready", "preview_ready", "preview_ready"]);
    expect(isTaskPackageReadyForFreeExport(creatives)).toBe(true);
    expect(countFinalRenderProgress(creatives).previewReady).toBe(AUTO_CLIP.CLIP_COUNT);
  });

  it("Case B — 3 x final_ready allows 720p export", () => {
    const creatives = pack(["final_ready", "final_ready", "final_ready"]);
    expect(isTaskPackageReadyForFreeExport(creatives)).toBe(true);
    expect(countFinalRenderProgress(creatives).previewReady).toBe(AUTO_CLIP.CLIP_COUNT);
  });

  it("Case C — mixed preview_ready/final_ready allows 720p export", () => {
    const creatives = pack(["preview_ready", "final_ready", "preview_ready"]);
    expect(isTaskPackageReadyForFreeExport(creatives)).toBe(true);
  });

  it("Case D — preview_rendering present is denied", () => {
    const creatives = pack(["preview_ready", "final_ready", "preview_rendering"]);
    expect(isTaskPackageReadyForFreeExport(creatives)).toBe(false);
  });

  it("Case E — final_rendering present is denied", () => {
    const creatives = pack(["preview_ready", "final_ready", "final_rendering"]);
    expect(isTaskPackageReadyForFreeExport(creatives)).toBe(false);
    expect(countFinalRenderProgress(creatives).previewReady).toBe(2);
  });

  it("Case F — failed present is denied", () => {
    const creatives = pack(["preview_ready", "final_ready", "failed"]);
    expect(isTaskPackageReadyForFreeExport(creatives)).toBe(false);
  });

  it("Case G — missing Creative is denied", () => {
    const creatives = pack(["preview_ready", "final_ready"]);
    expect(creatives).toHaveLength(2);
    expect(isTaskPackageReadyForFreeExport(creatives)).toBe(false);
  });

  it("Case H — unknown/non-authoritative renderStatus is denied", () => {
    const creatives = pack(["preview_ready", "final_ready", "not_a_render_status"]);
    expect(isTaskPackageReadyForFreeExport(creatives)).toBe(false);
    expect(
      isTaskPackageReadyForFreeExport(pack(["preview_ready", "final_ready", null]))
    ).toBe(false);
  });

  it("still requires the complete three-output package and usable preview artifact", () => {
    expect(
      isTaskPackageReadyForFreeExport(
        pack(["final_ready", "final_ready", "final_ready"], [{ videoUrl: null }, undefined, undefined])
      )
    ).toBe(false);
  });

  it("production-defect shape: three final_ready Creatives are not blocked as unready", () => {
    const creatives = pack(["final_ready", "final_ready", "final_ready"]);
    expect(creatives).toHaveLength(AUTO_CLIP.CLIP_COUNT);
    expect(creatives.every((c) => c.renderStatus === "final_ready" && c.videoUrl && c.videoExportUrl)).toBe(
      true
    );
    expect(isTaskPackageReadyForFreeExport(creatives)).toBe(true);
  });

  it("task export 409 gate uses the shared free-export package predicate", () => {
    const route = read("apps/web/src/app/api/tasks/[id]/export/route.ts");
    expect(route).toContain("renderProgress.previewReady >= AUTO_CLIP.CLIP_COUNT");
    expect(route).toContain("Not all clips are ready yet. Wait for rendering to finish.");
    expect(route).not.toContain("authorizeVideoStudioGeneration");
    expect(route).not.toContain("video-studio-entitlement");
  });
});

describe("VS-EDIT-V1-PROD-CERT-E1 POST /api/tasks/:id/export 720p", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REDIS_URL;
    requireAuth.mockResolvedValue({ id: USER_ID, email: "ops@local.test" });
    setTaskExportRequest.mockResolvedValue(undefined);
    enqueueTaskExport.mockResolvedValue({ id: "job-1" });
    getDb.mockReturnValue(exportDb());
  });

  it("production defect: 3 x final_ready reaches enqueue instead of 409", async () => {
    getTaskCreatives.mockResolvedValue(pack(["final_ready", "final_ready", "final_ready"]));
    const response = await post720pExport();
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.error).toBeUndefined();
    expect(body.status).toBe("export_pending");
    expect(body.resolution).toBe("720p");
    expect(enqueueTaskExport).toHaveBeenCalledTimes(1);
    expect(enqueueTaskExport.mock.calls[0]?.[0]).toMatchObject({
      taskId: TASK_ID,
      campaignId: CAMPAIGN_ID,
      workspaceId: WORKSPACE_ID,
      resolution: "720p",
    });
  });

  it("keeps the existing 409 copy when a final_rendering clip is present", async () => {
    getTaskCreatives.mockResolvedValue(pack(["final_ready", "final_ready", "final_rendering"]));
    const response = await post720pExport();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Not all clips are ready yet. Wait for rendering to finish.",
      code: "VALIDATION_ERROR",
    });
    expect(enqueueTaskExport).not.toHaveBeenCalled();
  });
});
