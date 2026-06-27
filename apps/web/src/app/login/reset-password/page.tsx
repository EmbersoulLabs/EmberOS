"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/brand";
import { EmberLogoWordmark } from "@/components/EmberLogo";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { useI18n } from "@/lib/i18n/provider";

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function init() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setReady(true);
        setChecking(false);
        return;
      }

      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session && !cancelled) {
          setReady(true);
          setChecking(false);
        }
      });
      unsubscribe = () => listener.subscription.unsubscribe();

      setTimeout(() => {
        if (!cancelled) setChecking(false);
      }, 2500);
    }

    void init();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setMessage(t("auth.passwordMismatch"));
      return;
    }
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setMessage(t("auth.passwordUpdated"));
    setTimeout(() => {
      window.location.href = "/workspaces";
    }, 1200);
  }

  const inputClass =
    "w-full rounded-lg border border-border px-3 py-2.5 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted p-4">
      <div className="absolute right-4 top-4">
        <LocaleSwitcher variant="light" />
      </div>

      <div className="w-full max-w-md rounded-xl border border-border/80 bg-surface p-8 shadow-card">
        <div className="mb-6 flex flex-col items-center text-center">
          <EmberLogoWordmark className="mb-4" />
          <p className="text-[11px] font-medium uppercase tracking-widest text-ink-secondary">
            {BRAND.positioning}
          </p>
          <h1 className="mt-2 text-xl font-semibold text-navy">{t("auth.resetPasswordTitle")}</h1>
          <p className="mt-1 text-sm text-ink-secondary">{t("auth.resetPasswordSubtitle")}</p>
        </div>

        {checking && (
          <p className="text-center text-sm text-ink-secondary">{t("auth.loading")}</p>
        )}

        {!checking && !ready && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-red-600">{t("auth.resetLinkInvalid")}</p>
            <Link
              href="/login"
              className="inline-block text-sm font-medium text-brand-blue hover:underline"
            >
              {t("auth.backToSignIn")}
            </Link>
          </div>
        )}

        {ready && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                {t("auth.newPassword")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={inputClass}
                required
                minLength={6}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                {t("auth.confirmPassword")}
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className={inputClass}
                required
                minLength={6}
              />
            </div>

            {message && (
              <p
                className={`text-sm ${
                  message === t("auth.passwordUpdated") ? "text-brand-teal" : "text-red-600"
                }`}
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-navy px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-navy/90 disabled:opacity-50"
            >
              {loading ? t("auth.loading") : t("auth.resetPassword")}
            </button>
          </form>
        )}

        <Link
          href="/login"
          className="mt-6 block text-center text-sm text-ink-secondary hover:text-navy"
        >
          {t("auth.backToSignIn")}
        </Link>
      </div>
    </div>
  );
}
