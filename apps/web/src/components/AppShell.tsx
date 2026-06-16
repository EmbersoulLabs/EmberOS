import Link from "next/link";

export function AppShell({
  children,
  workspaceName,
}: {
  children: React.ReactNode;
  workspaceName?: string;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/workspaces" className="text-lg font-bold text-slate-900">
            AIGC CEO
          </Link>
          {workspaceName && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
              {workspaceName}
            </span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700",
    processing: "bg-blue-100 text-blue-700",
    pending_internal_review: "bg-amber-100 text-amber-800",
    pending_client_review: "bg-purple-100 text-purple-800",
    approved: "bg-green-100 text-green-800",
    export_ready: "bg-emerald-100 text-emerald-800",
    failed: "bg-red-100 text-red-700",
    exported: "bg-green-100 text-green-800",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? "bg-slate-100 text-slate-600"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
