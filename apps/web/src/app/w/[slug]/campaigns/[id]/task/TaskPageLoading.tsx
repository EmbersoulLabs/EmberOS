"use client";

import { useI18n } from "@/lib/i18n/provider";

export function TaskPageLoading() {
  const { t } = useI18n();
  return <p className="p-6 text-slate-500">{t("common.loading")}</p>;
}
