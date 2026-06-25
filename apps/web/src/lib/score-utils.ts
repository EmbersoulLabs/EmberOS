export function scoreLetterGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 85) return "A-";
  if (score >= 80) return "B+";
  if (score >= 75) return "B";
  if (score >= 70) return "B-";
  if (score >= 65) return "C+";
  if (score >= 60) return "C";
  return "D";
}

export function deriveStrengths(score: Record<string, unknown>): string[] {
  const strengths: string[] = [];
  const hook = score.hookScore as number | undefined;
  const visual = score.visualScore as number | undefined;
  const copy = score.copyScore as number | undefined;
  const cta = score.ctaScore as number | undefined;
  const platform = score.platformFitScore as number | undefined;

  if ((visual ?? 0) >= 72) strengths.push("Strong product visibility");
  if ((hook ?? 0) >= 72) strengths.push("Compelling opening hook");
  if ((copy ?? 0) >= 72) strengths.push("Clear, persuasive messaging");
  if ((cta ?? 0) >= 70) strengths.push("Actionable call-to-action");
  if ((platform ?? 0) >= 72) strengths.push("Well-suited for target platform");
  if (strengths.length === 0) strengths.push("Solid foundation for short-form marketing");

  return strengths.slice(0, 4);
}
