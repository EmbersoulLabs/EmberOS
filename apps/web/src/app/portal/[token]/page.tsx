"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { useI18n } from "@/lib/i18n/provider";

export default function ClientPortalPage() {
  const params = useParams();
  const token = params.token as string;
  const { t } = useI18n();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/portal/${token}`)
      .then((r) => r.json())
      .then(setData);
  }, [token]);

  const creative = data?.creative as Record<string, unknown> | undefined;
  const brandName = data?.brandName as string;

  async function decide(decision: "approved" | "rejected") {
    await fetch(`/api/portal/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, comment }),
    });
    setDone(true);
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-slate-500">{t("portal.loading")}</p>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-600">{data.error as string}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto max-w-lg">
        <p className="mb-2 text-sm text-slate-500">{brandName}</p>
        <h1 className="mb-6 text-xl font-bold">{t("portal.reviewTitle")}</h1>

        {done ? (
          <p className="rounded-lg bg-green-50 p-4 text-green-800">{t("portal.thankYou")}</p>
        ) : (
          <>
            {creative?.videoUrl ? (
              <video
                src={creative.videoUrl as string}
                controls
                className="mb-4 w-full rounded-lg bg-black"
              />
            ) : (
              <div className="mb-4 flex h-48 items-center justify-center rounded-lg bg-slate-200">
                {t("portal.noPreview")}
              </div>
            )}

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("portal.commentPlaceholder")}
              className="mb-4 w-full rounded border px-3 py-2 text-sm"
              rows={3}
            />

            <div className="flex gap-3">
              <button
                onClick={() => decide("approved")}
                className="flex-1 rounded-lg bg-green-600 py-3 text-sm font-medium text-white"
              >
                {t("portal.approve")}
              </button>
              <button
                onClick={() => decide("rejected")}
                className="flex-1 rounded-lg bg-red-600 py-3 text-sm font-medium text-white"
              >
                {t("portal.reject")}
              </button>
            </div>
          </>
        )}
        <p className="mt-8 text-center text-xs text-slate-400">
          {t("portal.poweredBy", { product: BRAND.product, company: BRAND.company })}
        </p>
      </div>
    </div>
  );
}
