"use client";

import { BUSINESS_HOURS_DAYS, type BusinessHours, type BusinessHoursDayEntry } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";

interface BusinessHoursEditorProps {
  value: BusinessHours;
  onChange: (value: BusinessHours) => void;
}

export function BusinessHoursEditor({ value, onChange }: BusinessHoursEditorProps) {
  const { t } = useI18n();

  function patchDay(day: BusinessHoursDayEntry["day"], patch: Partial<BusinessHoursDayEntry>) {
    onChange(value.map((entry) => (entry.day === day ? { ...entry, ...patch } : entry)));
  }

  return (
    <div className="space-y-3">
      {BUSINESS_HOURS_DAYS.map((day) => {
        const entry = value.find((e) => e.day === day) ?? { day, isOpen: false };
        return (
          <div
            key={day}
            className="grid gap-3 rounded-xl border border-border/70 bg-surface-muted/30 p-3 sm:grid-cols-[120px_1fr_1fr_1fr]"
          >
            <label className="flex items-center gap-2 text-sm font-medium text-navy">
              <input
                type="checkbox"
                checked={entry.isOpen}
                onChange={(e) =>
                  patchDay(day, {
                    isOpen: e.target.checked,
                    openTime: e.target.checked ? entry.openTime ?? "09:00" : undefined,
                    closeTime: e.target.checked ? entry.closeTime ?? "18:00" : undefined,
                  })
                }
              />
              {t(`businessProfile.day.${day}` as "businessProfile.day.Monday")}
            </label>
            <input
              type="time"
              disabled={!entry.isOpen}
              value={entry.openTime ?? "09:00"}
              onChange={(e) => patchDay(day, { openTime: e.target.value })}
              className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
              aria-label={`${day} open`}
            />
            <input
              type="time"
              disabled={!entry.isOpen}
              value={entry.closeTime ?? "18:00"}
              onChange={(e) => patchDay(day, { closeTime: e.target.value })}
              className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
              aria-label={`${day} close`}
            />
          </div>
        );
      })}
    </div>
  );
}
