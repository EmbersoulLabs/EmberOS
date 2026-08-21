import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/platform-admin-auth";
import {
  createProductionVerificationFixture,
  runProductionVerificationStep,
  type ProductionVerificationStepTiming,
} from "@/lib/ai-story-production-verification-fixture";

function operatorPage(campaignId: string) {
  const action = `/api/admin/ai-story/campaigns/${campaignId}/production-verification-fixture`;
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>AI Story Production Verification Fixture</title></head><body><main><h1>AI Story Production Verification Fixture</h1><p>Creates exactly one deterministic three-scene, zero-provider verification context.</p><form method="post" action="${action}"><input type="hidden" name="confirm" value="true"><button type="submit">Create one verification fixture</button></form></main></body></html>`, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requirePlatformAdmin();
  const { id: campaignId } = await params;
  return operatorPage(campaignId);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const stepTimings: ProductionVerificationStepTiming[] = [];
  try {
    const { user } = await runProductionVerificationStep(
      "platform_admin_authority",
      () => requirePlatformAdmin(),
      { timings: stepTimings }
    );
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
      return apiError("Cross-origin fixture invocation denied", "FORBIDDEN", 403);
    }
    const raw = await request.text();
    const contentType = request.headers.get("content-type") ?? "";
    const validBody =
      !raw.trim() ||
      raw.trim() === "{}" ||
      (contentType.startsWith("application/x-www-form-urlencoded") && raw === "confirm=true");
    if (!validBody) {
      return apiError("Verification fixture accepts an empty object body only", "VALIDATION_ERROR", 422);
    }
    const { id: campaignId } = await params;
    const result = await createProductionVerificationFixture({
      campaignId,
      user,
      stepTimings,
    });
    return apiSuccess(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
