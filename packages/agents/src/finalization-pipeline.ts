import { createHash } from "node:crypto";

export const FINALIZATION_CONTRACT_VERSION = "1" as const;

export type GateStatus = "PASS" | "WARNING" | "FAIL" | "SKIPPED";
export type FinalizationCheckpoint =
  | "VIDEO_GATES_COMPLETE"
  | "VIDEO_COMPLETE";

export interface GateExecutionContext {
  taskId: string;
  campaignId: string;
  finalOutputReferences: readonly string[];
}

export interface GateResult {
  gateId: string;
  status: GateStatus;
  warnings: readonly string[];
  provenance: readonly string[];
  metadata?: Readonly<Record<string, unknown>>;
}

export interface Gate {
  readonly id: string;
  execute(context: Readonly<GateExecutionContext>): Promise<GateResult>;
}

export interface GateSummary {
  status: "PASS" | "WARNING" | "FAIL";
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  skipped: number;
}

export interface FinalizationResult {
  contractVersion: typeof FINALIZATION_CONTRACT_VERSION;
  pipelineState: "COMPLETED";
  checkpoint: "VIDEO_COMPLETE";
  checkpointHistory: readonly FinalizationCheckpoint[];
  gateSummary: Readonly<GateSummary>;
  gateResults: readonly Readonly<GateResult>[];
  warnings: readonly string[];
  provenance: readonly string[];
  timestamp: string;
  deterministicFingerprint: string;
}

export interface FinalizationPipelineInput extends GateExecutionContext {
  inputCheckpoint: "VIDEO_RENDER_COMPLETE";
  gates: readonly Gate[];
  timestamp?: string;
}

const GATE_STATUSES = new Set<GateStatus>([
  "PASS",
  "WARNING",
  "FAIL",
  "SKIPPED",
]);

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)])
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export class GateRunner {
  async run(
    gates: readonly Gate[],
    context: Readonly<GateExecutionContext>
  ): Promise<{
    results: readonly Readonly<GateResult>[];
    summary: Readonly<GateSummary>;
  }> {
    const results: GateResult[] = [];
    for (const gate of gates) {
      const result = await gate.execute(deepFreeze({ ...context }));
      if (result.gateId !== gate.id) {
        throw new Error(`Gate ${gate.id} returned mismatched result ${result.gateId}`);
      }
      if (!GATE_STATUSES.has(result.status)) {
        throw new Error(`Gate ${gate.id} returned invalid status`);
      }
      if (!Array.isArray(result.warnings) || !Array.isArray(result.provenance)) {
        throw new Error(`Gate ${gate.id} returned an invalid canonical result`);
      }
      results.push({
        ...result,
        warnings: [...result.warnings],
        provenance: [...result.provenance],
      });
    }

    const summary: GateSummary = {
      status: results.some((result) => result.status === "FAIL")
        ? "FAIL"
        : results.some(
              (result) =>
                result.status === "WARNING" || result.status === "SKIPPED"
            )
          ? "WARNING"
          : "PASS",
      total: results.length,
      passed: results.filter((result) => result.status === "PASS").length,
      warnings: results.filter((result) => result.status === "WARNING").length,
      failed: results.filter((result) => result.status === "FAIL").length,
      skipped: results.filter((result) => result.status === "SKIPPED").length,
    };

    return deepFreeze({ results, summary });
  }
}

export class FinalizationPipeline {
  constructor(private readonly gateRunner: GateRunner = new GateRunner()) {}

  async execute(input: FinalizationPipelineInput): Promise<FinalizationResult> {
    if (input.inputCheckpoint !== "VIDEO_RENDER_COMPLETE") {
      throw new Error(
        `Finalization requires VIDEO_RENDER_COMPLETE, received ${String(input.inputCheckpoint)}`
      );
    }
    if (
      !Array.isArray(input.finalOutputReferences) ||
      input.finalOutputReferences.length === 0 ||
      input.finalOutputReferences.some(
        (reference) =>
          typeof reference !== "string" || reference.trim().length === 0
      )
    ) {
      throw new Error(
        "Finalization requires at least one valid final output reference"
      );
    }
    const context: GateExecutionContext = {
      taskId: input.taskId,
      campaignId: input.campaignId,
      finalOutputReferences: [...input.finalOutputReferences],
    };
    const { results, summary } = await this.gateRunner.run(input.gates, context);
    if (summary.status === "FAIL") {
      const failed = results
        .filter((result) => result.status === "FAIL")
        .map((result) => result.gateId);
      throw new Error(`Finalization gates failed: ${failed.join(", ")}`);
    }

    const warnings = results.flatMap((result) => result.warnings);
    const provenance = [...new Set(results.flatMap((result) => result.provenance))];
    const deterministicFingerprint = fingerprint({
      contractVersion: FINALIZATION_CONTRACT_VERSION,
      taskId: input.taskId,
      campaignId: input.campaignId,
      finalOutputReferences: [...input.finalOutputReferences].sort(),
      results,
    });

    return deepFreeze({
      contractVersion: FINALIZATION_CONTRACT_VERSION,
      pipelineState: "COMPLETED",
      checkpoint: "VIDEO_COMPLETE",
      checkpointHistory: [
        "VIDEO_GATES_COMPLETE",
        "VIDEO_COMPLETE",
      ] as const,
      gateSummary: summary,
      gateResults: results,
      warnings,
      provenance,
      timestamp: input.timestamp ?? new Date().toISOString(),
      deterministicFingerprint,
    }) as FinalizationResult;
  }
}

export function recordedGate(result: GateResult): Gate {
  const immutableResult = deepFreeze({
    ...result,
    warnings: [...result.warnings],
    provenance: [...result.provenance],
  }) as Readonly<GateResult>;
  return {
    id: result.gateId,
    async execute() {
      return immutableResult;
    },
  };
}

export function readFinalizationResult(value: unknown): FinalizationResult {
  if (!value || typeof value !== "object") {
    throw new Error("Finalization result must be an object");
  }
  const result = value as Partial<FinalizationResult>;
  if (result.contractVersion !== FINALIZATION_CONTRACT_VERSION) {
    throw new Error("Unsupported Finalization contract version");
  }
  if (
    result.pipelineState !== "COMPLETED" ||
    result.checkpoint !== "VIDEO_COMPLETE"
  ) {
    throw new Error("Finalization result is not complete");
  }
  if (
    !Array.isArray(result.checkpointHistory) ||
    result.checkpointHistory.join(",") !==
      "VIDEO_GATES_COMPLETE,VIDEO_COMPLETE"
  ) {
    throw new Error("Invalid Finalization checkpoint progression");
  }
  if (
    !result.gateSummary ||
    !Array.isArray(result.gateResults) ||
    !Array.isArray(result.warnings) ||
    !Array.isArray(result.provenance) ||
    typeof result.timestamp !== "string" ||
    typeof result.deterministicFingerprint !== "string" ||
    result.deterministicFingerprint.length === 0
  ) {
    throw new Error("Invalid Finalization result");
  }
  return deepFreeze(result) as FinalizationResult;
}

export function resolveFinalizationResult(
  existing: unknown,
  candidate: FinalizationResult
): FinalizationResult {
  const accepted = readFinalizationResult(existing);
  if (
    accepted.deterministicFingerprint !== candidate.deterministicFingerprint
  ) {
    throw new Error(
      "Conflicting Finalization result: final output fingerprint changed"
    );
  }
  return accepted;
}
