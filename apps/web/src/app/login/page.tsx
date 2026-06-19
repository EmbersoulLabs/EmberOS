"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/brand";
import { EmberLogo } from "@/components/EmberLogo";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { useI18n } from "@/lib/i18n/provider";

export default function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      setMessage(error ? error.message : t("auth.checkEmail"));
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage(error.message);
      else window.location.href = "/workspaces";
    }
    setLoading(false);
  }

  return (
    <div className="ember-page-bg flex min-h-screen items-center justify-center p-4">
      <div className="absolute right-4 top-4">
        <LocaleSwitcher variant="light" />
      </div>
      <div className="ember-card w-full max-w-md rounded-2xl p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <EmberLogo className="mb-4 h-14 w-14 shadow-ember" />
          <h1 className="text-2xl font-bold text-coal">{BRAND.product}</h1>
          <p className="mt-1 text-sm font-medium text-ember">{BRAND.company}</p>
          <p className="text-xs text-stone-500">{BRAND.domain}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{t("auth.email")}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              required
              minLength={6}
            />
          </div>

          {message && (
            <p
              className={`text-sm ${message === t("auth.checkEmail") ? "text-green-600" : "text-red-600"}`}
            >
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-ember transition hover:bg-primary-hover disabled:opacity-50"
          >
            {loading ? "..." : isSignUp ? t("auth.signUp") : t("auth.signIn")}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setIsSignUp(!isSignUp)}
          className="mt-4 w-full text-center text-sm text-stone-500 hover:text-ember"
        >
          {isSignUp ? t("auth.signInLink") : t("auth.signUpLink")}
        </button>
      </div>
    </div>
  );
}
