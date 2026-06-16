"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    async function load() {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();

      if (me.orgs?.length === 0) {
        const orgRes = await fetch("/api/organizations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "My Agency", slug: "my-agency" }),
        });
        const orgData = await orgRes.json();
        setOrgId(orgData.organization?.id);
      } else {
        setOrgId(me.orgs[0].id);
      }

      const wsRes = await fetch("/api/workspaces");
      const wsData = await wsRes.json();
      setWorkspaces(wsData.workspaces ?? []);
      setLoading(false);
    }
    load();
  }, []);

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !newName) return;

    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, name: newName }),
    });
    const data = await res.json();
    if (data.workspace) {
      setWorkspaces((prev) => [...prev, { ...data.workspace, role: "admin" }]);
      setNewName("");
      setShowCreate(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Workspaces</h1>
          <p className="text-sm text-slate-500">Manage brands and client accounts</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          New Workspace
        </button>
      </div>

      {showCreate && (
        <form onSubmit={createWorkspace} className="mb-6 rounded-lg border bg-white p-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Workspace name"
            className="mb-3 w-full rounded border px-3 py-2 text-sm"
            required
          />
          <div className="flex gap-2">
            <button type="submit" className="rounded bg-primary px-3 py-1.5 text-sm text-white">
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-slate-500">Loading...</p>
      ) : workspaces.length === 0 ? (
        <p className="text-slate-500">No workspaces yet. Create one to get started.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((ws) => (
            <Link
              key={ws.id}
              href={`/w/${ws.slug}/campaigns`}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-primary hover:shadow-md"
            >
              <h2 className="font-semibold text-slate-900">{ws.name}</h2>
              <p className="mt-1 text-sm text-slate-500">Role: {ws.role}</p>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
