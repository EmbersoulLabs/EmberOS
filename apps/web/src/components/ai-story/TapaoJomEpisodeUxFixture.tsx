import { TAPAO_JOM_EPISODE_UX_FIXTURE } from "@ceo-agent/shared";

export function TapaoJomEpisodeUxFixture() {
  return (
    <section className="rounded-2xl border border-border bg-white p-4" data-testid="tapao-jom-episode-ux-fixture">
      <h2 className="text-lg font-bold text-navy">{TAPAO_JOM_EPISODE_UX_FIXTURE.title}</h2>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-secondary">
        {TAPAO_JOM_EPISODE_UX_FIXTURE.workflow.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
