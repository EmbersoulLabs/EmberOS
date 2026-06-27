"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  loadRememberedCredentials,
  saveRememberedCredentials,
  clearRememberedCredentials,
} from "@/lib/auth-remember";
import { BRAND } from "@/lib/brand";
import { EmberLogoWordmark } from "@/components/EmberLogo";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { useI18n } from "@/lib/i18n/provider";

type AuthMode = "signIn" | "signUp" | "forgot";

export default function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const saved = loadRememberedCredentials();
    if (!saved) return;
    setEmail(saved.email);
    setPassword(saved.password);
    setRememberPassword(true);
  }, []);

  function switchMode(next: AuthMode) {
    setMode(next);
    setMessage("");
    if (next !== "signUp") setAgreedToTerms(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    if (mode === "forgot") {
      const redirectTo = `${window.location.origin}/login/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      setMessage(error ? error.message : t("auth.forgotPasswordSent"));
      setLoading(false);
      return;
    }

    if (mode === "signUp" && !agreedToTerms) {
      setMessage(t("auth.mustAgreeTerms"));
      setLoading(false);
      return;
    }

    if (mode === "signUp") {
      const { error } = await supabase.auth.signUp({ email, password });
      setMessage(error ? error.message : t("auth.checkEmail"));
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
      } else {
        if (rememberPassword) {
          saveRememberedCredentials(email, password);
        } else {
          clearRememberedCredentials();
        }
        window.location.href = "/workspaces";
      }
    }
    setLoading(false);
  }

  const inputClass =
    "w-full rounded-lg border border-border px-3 py-2.5 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20";

  const title =
    mode === "forgot"
      ? t("auth.forgotPasswordTitle")
      : mode === "signUp"
        ? t("auth.signUp")
        : t("auth.signIn");

  const subtitle =
    mode === "forgot" ? t("auth.forgotPasswordSubtitle") : BRAND.positioning;

  const successMessage =
    mode === "forgot"
      ? t("auth.forgotPasswordSent")
      : mode === "signUp"
        ? t("auth.checkEmail")
        : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted p-4">
      <div className="absolute right-4 top-4">
        <LocaleSwitcher variant="light" />
      </div>

      <div className="w-full max-w-md rounded-xl border border-border/80 bg-surface p-8 shadow-card">
        <div className="mb-6 flex flex-col items-center text-center">
          <EmberLogoWordmark className="mb-4" />
          <p className="text-[11px] font-medium uppercase tracking-widest text-ink-secondary">
            {BRAND.product} · {BRAND.positioning}
          </p>
          <h1 className="mt-2 text-xl font-semibold text-navy">{title}</h1>
          <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              {t("auth.email")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className={inputClass}
              required
            />
          </div>

          {mode !== "forgot" && (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                  {t("auth.password")}
                </label>
                {mode === "signIn" && (
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="text-xs font-medium text-brand-blue hover:underline"
                  >
                    {t("auth.forgotPasswordLink")}
                  </button>
                )}
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signUp" ? "new-password" : "current-password"}
                className={inputClass}
                required
                minLength={6}
              />
            </div>
          )}

          {mode === "signIn" && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={rememberPassword}
                onChange={(e) => setRememberPassword(e.target.checked)}
                className="h-4 w-4 rounded border-border text-navy focus:ring-brand-blue/30"
              />
              {t("auth.rememberPassword")}
            </label>
          )}

          {mode === "signUp" && (
            <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-navy focus:ring-brand-blue/30"
                required
              />
              <span>
                {t("auth.agreeTermsPrefix")}{" "}
                <a
                  href={BRAND.legal.termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-blue underline hover:text-navy"
                >
                  {t("auth.termsLink")}
                </a>{" "}
                {t("auth.agreeTermsJoiner")}{" "}
                <a
                  href={BRAND.legal.privacyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-blue underline hover:text-navy"
                >
                  {t("auth.privacyLink")}
                </a>
              </span>
            </label>
          )}

          {message && (
            <p
              className={`text-sm ${
                successMessage && message === successMessage ? "text-brand-teal" : "text-red-600"
              }`}
            >
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || (mode === "signUp" && !agreedToTerms)}
            className="w-full rounded-lg bg-navy px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-navy/90 disabled:opacity-50"
          >
            {loading
              ? t("auth.loading")
              : mode === "forgot"
                ? t("auth.forgotPassword")
                : mode === "signUp"
                  ? t("auth.signUp")
                  : t("auth.signIn")}
          </button>
        </form>

        <div className="mt-5 space-y-2 text-center text-sm">
          {mode === "forgot" ? (
            <button
              type="button"
              onClick={() => switchMode("signIn")}
              className="text-ink-secondary hover:text-navy"
            >
              {t("auth.backToSignIn")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchMode(mode === "signUp" ? "signIn" : "signUp")}
              className="text-ink-secondary hover:text-navy"
            >
              {mode === "signUp" ? t("auth.signInLink") : t("auth.signUpLink")}
            </button>
          )}
        </div>
      </div>

      <footer className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-ink-secondary">
        <span>
          &copy; {new Date().getFullYear()} {BRAND.company}
        </span>
        <span aria-hidden="true">·</span>
        <a
          href={BRAND.legal.termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-navy"
        >
          {t("auth.termsLink")}
        </a>
        <span aria-hidden="true">·</span>
        <a
          href={BRAND.legal.privacyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-navy"
        >
          {t("auth.privacyLink")}
        </a>
      </footer>
    </div>
  );
}
