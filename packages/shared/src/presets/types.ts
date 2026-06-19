import { z } from "zod";
import { IndustrySchema } from "../types/marketing-os";

export const PresetIdSchema = z.enum([
  "marketing",
  "wedding",
  "florist",
  "education",
  "story",
  "podcast",
  "property",
  "beauty",
  "restaurant",
  "corporate",
]);
export type PresetId = z.infer<typeof PresetIdSchema>;

export const ContentTypeSchema = z.enum([
  "product_showcase",
  "service_promotion",
  "wedding",
  "florist",
  "restaurant",
  "beauty",
  "education",
  "real_estate",
  "phone_buyback",
  "podcast",
  "storytelling",
  "event_promotion",
  "recruitment",
  "branding",
  "general",
]);
export type ContentType = z.infer<typeof ContentTypeSchema>;

export const SceneRoleSchema = z.enum(["hook", "product", "benefits", "proof", "cta"]);
export type SceneRole = z.infer<typeof SceneRoleSchema>;

export const ClipMotionSchema = z.enum([
  "static",
  "slow_zoom_in",
  "slow_zoom_out",
  "pan_left",
  "pan_right",
  "pan_up",
  "focus_pull",
  "fade_in",
]);
export type ClipMotion = z.infer<typeof ClipMotionSchema>;

export const ContentClassificationSchema = z.object({
  industry: IndustrySchema,
  contentType: ContentTypeSchema,
  presetId: PresetIdSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),
});
export type ContentClassification = z.infer<typeof ContentClassificationSchema>;

export interface PresetProfile {
  id: PresetId;
  label: string;
  labelZh: string;
  /** Seconds per scene role in output timeline */
  scenePacing: Record<SceneRole, number>;
  motionByRole: Record<SceneRole, ClipMotion>;
  speedByRole: Record<SceneRole, number>;
  captionStyle: "bold_hook" | "minimal" | "bilingual";
  ctaStyle: "pulse" | "slide_up" | "banner";
  cutStyle: "jump" | "soft";
}
