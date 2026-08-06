import type { ProviderLedgerExecution } from "./provider-ledger";
import { ProviderLedgerRepository } from "./provider-ledger";
import { ProviderOutboxRepository } from "./provider-outbox";
import type { ProviderOutboxJob } from "@ceo-agent/shared";

export interface ProviderReconciliationSnapshot {
  readonly ledger: ProviderLedgerExecution;
  readonly outboxJob: ProviderOutboxJob | null;
}

export class ProviderReconciliationRepository {
  constructor(
    private readonly ledger = new ProviderLedgerRepository(),
    private readonly outbox = new ProviderOutboxRepository()
  ) {}

  async load(
    executionId: string,
    jobId: string
  ): Promise<ProviderReconciliationSnapshot | null> {
    const [ledger, outboxJob] = await Promise.all([
      this.ledger.findExecution(executionId),
      this.outbox.findJob(jobId),
    ]);
    return ledger ? Object.freeze({ ledger, outboxJob }) : null;
  }
}
