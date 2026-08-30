/**
 * In-memory Assembly Job repository for controlled runtime / FFmpeg tests.
 * Append-only facts. No update/delete.
 */
import {
  AssemblyJobAcceptedFactSchema,
  AssemblyJobFactSchema,
  AssemblyJobSchema,
  assemblyIntegrityHash,
  type AssemblyJob,
  type AssemblyJobAcceptedFact,
  type AssemblyJobFact,
} from "@ceo-agent/shared/server";
import type {
  AppendAssemblyJobFactResult,
  AssemblyJobRepository,
  AssemblyTerminalAcceptanceLock,
} from "@ceo-agent/db";

function deterministicFactUuid(integrityHash: string): string {
  const hex = integrityHash.replace(/^sha256:/, "").slice(0, 32);
  const bytes = hex.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const normalized = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}

export function buildMemoryAcceptedFact(job: AssemblyJob): AssemblyJobAcceptedFact {
  const payload = {
    factKind: "ACCEPTED" as const,
    assemblyJobId: job.assemblyJobId,
    executionPlanId: job.executionPlanId,
    ownership: job.ownership,
    assemblyDefinitionId: job.assemblyDefinitionId,
    deterministicFingerprint: job.deterministicFingerprint,
    assemblyEngineSnapshotId: job.assemblyEngineSnapshotId,
    assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
    acceptedAt: job.acceptedAt,
    contractVersion: "1" as const,
  };
  const integrityHash = assemblyIntegrityHash({
    kind: "assembly-job-accepted-fact",
    ...payload,
  });
  return AssemblyJobAcceptedFactSchema.parse({
    ...payload,
    factId: deterministicFactUuid(integrityHash),
    integrityHash,
  });
}

export function createInMemoryAssemblyJobRepository(
  seedJobs: readonly AssemblyJob[] = []
): AssemblyJobRepository {
  const jobs = new Map<string, AssemblyJob>();
  const facts = new Map<string, AssemblyJobFact[]>();

  for (const job of seedJobs) {
    const parsed = AssemblyJobSchema.parse(job);
    jobs.set(parsed.assemblyJobId, parsed);
    facts.set(parsed.assemblyJobId, [buildMemoryAcceptedFact(parsed)]);
  }

  async function appendFactInternal(
    input: AssemblyJobFact
  ): Promise<AppendAssemblyJobFactResult> {
    const fact = AssemblyJobFactSchema.parse(input);
    const existing = facts.get(fact.assemblyJobId) ?? [];
    const sameId = existing.find((row) => row.factId === fact.factId);
    if (sameId) return { fact: sameId, replayed: true };
    const sameHash = existing.find((row) => row.integrityHash === fact.integrityHash);
    if (sameHash) return { fact: sameHash, replayed: true };

    if (fact.factKind === "SUCCEEDED" || fact.factKind === "FAILED") {
      const terminal = existing.find(
        (row) => row.factKind === "SUCCEEDED" || row.factKind === "FAILED"
      );
      if (terminal) {
        if (terminal.integrityHash === fact.integrityHash) {
          return { fact: terminal, replayed: true };
        }
        throw new Error("Terminal Assembly fact conflict");
      }
    }

    facts.set(fact.assemblyJobId, [...existing, fact]);
    return { fact, replayed: false };
  }

  return {
    async getByAssemblyJobId(assemblyJobId) {
      return jobs.get(assemblyJobId) ?? null;
    },
    async getByDeterministicFingerprint(deterministicFingerprint) {
      for (const job of jobs.values()) {
        if (job.deterministicFingerprint === deterministicFingerprint) return job;
      }
      return null;
    },
    async getLatestByExecutionPlanId(executionPlanId) {
      let latest: AssemblyJob | null = null;
      for (const job of jobs.values()) {
        if (job.executionPlanId !== executionPlanId) continue;
        if (!latest || job.acceptedAt >= latest.acceptedAt) {
          latest = job;
        }
      }
      return latest;
    },
    async acceptOrConverge(input) {
      const job = AssemblyJobSchema.parse(input);
      const existing = jobs.get(job.assemblyJobId);
      if (existing) {
        const accepted = (facts.get(existing.assemblyJobId) ?? []).find(
          (fact) => fact.factKind === "ACCEPTED"
        );
        if (!accepted || accepted.factKind !== "ACCEPTED") {
          throw new Error("Accepted Assembly Job missing ACCEPTED fact");
        }
        return { job: existing, acceptedFact: accepted, replayed: true };
      }
      jobs.set(job.assemblyJobId, job);
      const acceptedFact = buildMemoryAcceptedFact(job);
      facts.set(job.assemblyJobId, [acceptedFact]);
      return { job, acceptedFact, replayed: false };
    },
    async acquireTerminalAcceptanceLock(assemblyJobId) {
      const job = jobs.get(assemblyJobId);
      if (!job) throw new Error("Assembly Job not found");
      const lock: AssemblyTerminalAcceptanceLock = {
        assemblyJobId,
        job,
        run: async (work) =>
          work({
            job,
            appendFact: async (fact) => appendFactInternal(fact),
          }),
      };
      return lock;
    },
    async appendAssemblyJobFact(fact) {
      return appendFactInternal(fact);
    },
    async loadAssemblyFacts(assemblyJobId) {
      return facts.get(assemblyJobId) ?? [];
    },
  };
}
