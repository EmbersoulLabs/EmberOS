"use client";

import { useState, useMemo, useEffect } from "react";
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

export default function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    if (isSignUp && !agreedToTerms) {
      setMessage(t("auth.mustAgreeTerms"));
      setLoading(false);
      return;
    }

    if (isSignUp) {
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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted p-4">
      <div className="absolute right-4 top-4">
        <LocaleSwitcher variant="light" />
      </div>
      <div className="brand-card w-full max-w-md p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <EmberLogoWordmark className="mb-4" />
          <h1 className="text-2xl font-bold text-navy">{BRAND.product}</h1>
          <p className="mt-1 text-sm text-ink-secondary">{BRAND.positioning}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{t("auth.email")}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{t("auth.password")}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              required
              minLength={6}
            />
          </div>

          {!isSignUp && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={rememberPassword}
                onChange={(e) => setRememberPassword(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              {t("auth.rememberPassword")}
            </label>
          )}

          {isSignUp && (
            <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary focus:ring-primary"
                required
              />
              <span>
                {t("auth.agreeTermsPrefix")}{" "}
                <a
                  href={BRAND.legal.termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:text-primary-hover"
                >
                  {t("auth.termsLink")}
                </a>{" "}
                {t("auth.agreeTermsJoiner")}{" "}
                <a
                  href={BRAND.legal.privacyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:text-primary-hover"
                >
                  {t("auth.privacyLink")}
                </a>
              </span>
            </label>
          )}

          {message && (
            <p
              className={`text-sm ${message === t("auth.checkEmail") ? "text-green-600" : "text-red-600"}`}
            >
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || (isSignUp && !agreedToTerms)}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-ember transition hover:bg-primary-hover disabled:opacity-50"
          >
            {loading ? "..." : isSignUp ? t("auth.signUp") : t("auth.signIn")}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setIsSignUp(!isSignUp);
            setMessage("");
            if (!isSignUp) setAgreedToTerms(false);
          }}
          className="mt-4 w-full text-center text-sm text-stone-500 hover:text-ember"
        >
          {isSignUp ? t("auth.signInLink") : t("auth.signUpLink")}
        </button>
      </div>

      <footer className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-stone-500">
        <span>&copy; {new Date().getFullYear()} {BRAND.company}</span>
        <span aria-hidden="true">·</span>
        <a
          href={BRAND.legal.termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-ember"
        >
          {t("auth.termsLink")}
        </a>
        <span aria-hidden="true">·</span>
        <a
          href={BRAND.legal.privacyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-ember"
        >
          {t("auth.privacyLink")}
        </a>
      </footer>
    </div>
  );
}
