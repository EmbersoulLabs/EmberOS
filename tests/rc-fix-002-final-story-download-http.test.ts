import { beforeAll, describe, expect, it, vi } from "vitest";

const requireAuth = vi.fn();
const createDelivery = vi.fn();
vi.mock("@/lib/auth", async () => ({ requireAuth: () => requireAuth(), handleApiError: () => new Response(JSON.stringify({ error: "Request failed", code: "INTERNAL_ERROR" }), { status: 500, headers: { "content-type": "application/json" } }) }));
vi.mock("@/lib/ai-story-final-story-delivery", async () => {
  class FinalStoryDeliveryError extends Error { constructor(readonly code: string, readonly status: number) { super(code === "FINAL_STORY_RESULT_NOT_READY" ? "Final Story Result is not ready" : "Final Story video is unavailable"); } }
  return { createFinalStoryDelivery: (...args: unknown[]) => createDelivery(...args), FinalStoryDeliveryError };
});

describe("RC-FIX-002 HTTP delivery boundary", () => {
  let post: any;
  const params = Promise.resolve({ id: "10000000-0000-4000-8000-000000000003", storyId: "10000000-0000-4000-8000-000000000004", executionPlanId: "10000000-0000-4000-8000-000000000005" });
  beforeAll(async () => { ({ POST: post } = await import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/final-story-result/download/route")); }, 30_000);

  it("returns only safe signed delivery information and ignores forged request media fields", async () => {
    requireAuth.mockResolvedValueOnce({ id: "user" });
    createDelivery.mockResolvedValueOnce({ downloadUrl: "https://signed.example/final?token=x", filename: "story-final.mp4", expiresInSeconds: 900 });
    const res = await post(new Request("http://localhost/download", { method: "POST", body: JSON.stringify({ bucket: "other", objectKey: "foreign.mp4", providerUrl: "https://evil.test" }) }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ downloadUrl: expect.stringContaining("signed.example"), filename: "story-final.mp4", expiresInSeconds: 900 });
    expect(createDelivery).toHaveBeenCalledWith(expect.not.objectContaining({ bucket: expect.anything(), objectKey: expect.anything(), providerUrl: expect.anything() }));
  });

  it.each([["FINAL_STORY_RESULT_NOT_READY", 404], ["FINAL_STORY_MEDIA_UNAVAILABLE", 409]])("returns stable %s", async (code, status) => {
    requireAuth.mockResolvedValueOnce({ id: "user" });
    const { FinalStoryDeliveryError } = await import("../apps/web/src/lib/ai-story-final-story-delivery");
    createDelivery.mockRejectedValueOnce(new FinalStoryDeliveryError(code as any, status as any));
    const res = await post(new Request("http://localhost/download", { method: "POST" }), { params });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });

  it("hides signed-storage failure details", async () => {
    requireAuth.mockResolvedValueOnce({ id: "user" });
    createDelivery.mockRejectedValueOnce(new Error("Failed to create download URL"));
    const res = await post(new Request("http://localhost/download", { method: "POST" }), { params });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ code: "FINAL_STORY_DELIVERY_FAILED" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
