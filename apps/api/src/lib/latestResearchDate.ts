/** The freshest day a research dataset actually KNEW something — the latest `observedAt` anywhere
 * in it (evidence, provenance, …), found by walking the whole object so a field the schema adds
 * later is never silently missed. Deliberately ignores every other timestamp: `publishedAt` in
 * particular is often a journal's future cover date (a "January 2027" issue whose preprint was
 * observed in May 2026), and scenario/expiry fields are forward-looking by design — neither says
 * anything about how fresh the dataset is. Same logic as `apps/cli/src/commands/
 * matchForwardStatus.ts`'s own copy (the CLI is an app, not a library this package depends on). */
export function latestResearchDate(dataset: unknown): string | undefined {
  let latest: string | undefined;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'observedAt' && typeof child === 'string') {
        const day = child.slice(0, 'YYYY-MM-DD'.length);
        if (latest === undefined || day > latest) latest = day;
      } else {
        visit(child);
      }
    }
  };
  visit(dataset);
  return latest;
}
