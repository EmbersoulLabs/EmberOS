import type {
  AiStoryPreDispatchBundleSupersessionRepository,
  AiStoryPreDispatchBundleSupersessionResult,
  SupersedeAiStoryPreDispatchBundleInput,
} from "@ceo-agent/db";

export type PreDispatchBundleSupersessionPort = Pick<
  AiStoryPreDispatchBundleSupersessionRepository,
  "supersede"
>;

/** Application command boundary; the repository owns the single transaction. */
export class SupersedeAiStoryPreDispatchBundleService {
  constructor(private readonly repository: PreDispatchBundleSupersessionPort) {}

  execute(
    input: SupersedeAiStoryPreDispatchBundleInput
  ): Promise<AiStoryPreDispatchBundleSupersessionResult> {
    return this.repository.supersede(input);
  }
}
