import { z } from "zod";

export const BUSINESS_HOURS_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type BusinessHoursDay = (typeof BUSINESS_HOURS_DAYS)[number];

export const BusinessHoursDayEntrySchema = z
  .object({
    day: z.enum(BUSINESS_HOURS_DAYS),
    isOpen: z.boolean(),
    openTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    closeTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.isOpen && (!entry.openTime || !entry.closeTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Open days require openTime and closeTime",
      });
    }
  });

export const BusinessHoursSchema = z.array(BusinessHoursDayEntrySchema);

export type BusinessHoursDayEntry = z.infer<typeof BusinessHoursDayEntrySchema>;
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

export function emptyBusinessHours(): BusinessHours {
  return BUSINESS_HOURS_DAYS.map((day) => ({ day, isOpen: false }));
}

export function patchBusinessHoursDay(
  value: BusinessHours,
  day: BusinessHoursDay,
  patch: Partial<BusinessHoursDayEntry>
): BusinessHours {
  const current = value.find((entry) => entry.day === day) ?? { day, isOpen: false };
  const updated = { ...current, ...patch, day };

  return BUSINESS_HOURS_DAYS.map((candidate) =>
    candidate === day
      ? updated
      : value.find((entry) => entry.day === candidate) ?? { day: candidate, isOpen: false }
  );
}

export function normalizeBusinessHours(raw: unknown): BusinessHours {
  const parsed = BusinessHoursSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return emptyBusinessHours();
}
