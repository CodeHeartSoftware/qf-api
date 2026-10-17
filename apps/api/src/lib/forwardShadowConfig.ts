// Same SM4-specific duck-typing `apps/cli/src/lib/forwardShadowConfig.ts` uses for
// `matchForwardStatus`/`matchForwardRefresh` — reading only the two `FORWARD_SHADOW` fields this
// package's own `/api/market-data/status` route needs out of a forward match's opaque
// `record.config`. Duplicated rather than imported: `apps/cli` isn't a library other apps depend
// on (see `packages/README.md`'s app-vs-package split), and this is a handful of lines.

export interface MarketDatasetRef {
  id: string;
  version: string;
  dbPath?: string;
}

export function readForwardShadowFields(
  config: unknown,
): { marketDataUniverse: string[]; marketDataset: MarketDatasetRef } | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const c = config as Record<string, unknown>;
  const universe = c.marketDataUniverse;
  const dataset = c.marketDataset;
  if (!Array.isArray(universe) || !universe.every((t) => typeof t === 'string')) return undefined;
  if (typeof dataset !== 'object' || dataset === null) return undefined;
  const d = dataset as Record<string, unknown>;
  if (typeof d.id !== 'string' || typeof d.version !== 'string') return undefined;
  return {
    marketDataUniverse: universe,
    marketDataset: {
      id: d.id,
      version: d.version,
      ...(typeof d.dbPath === 'string' ? { dbPath: d.dbPath } : {}),
    },
  };
}
