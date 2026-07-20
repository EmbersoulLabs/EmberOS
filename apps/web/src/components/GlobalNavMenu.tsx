"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/provider";

function MenuIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm1 4a1 1 0 100 2h12a1 1 0 100-2H4z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export type GlobalNavItem = {
  id: string;
  label: string;
  href?: string;
  onClick?: () => void;
  current?: boolean;
};

export function GlobalNavMenu({ items }: { items: GlobalNavItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label={t("nav.globalNavigation")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white"
      >
        <MenuIcon />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-50 mt-2 min-w-[11.5rem] overflow-hidden rounded-xl border border-border bg-white py-1 shadow-elevated"
        >
          {items.map((item) => {
            const className = `block w-full px-3 py-2.5 text-left text-sm transition ${
              item.current
                ? "bg-navy/5 font-semibold text-navy"
                : "text-coal hover:bg-surface-muted"
            }`;
            if (item.href) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  role="menuitem"
                  aria-current={item.current ? "page" : undefined}
                  className={className}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={className}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function useLogoutAction() {
  const router = useRouter();
  return useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);
}
