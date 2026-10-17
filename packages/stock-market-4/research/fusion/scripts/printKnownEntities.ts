/**
 * Prints every entity currently in the fusion research dataset as `id — name` lines, generated
 * fresh from the real (migration-reconstructed) dataset (never hand-copied, so it can't drift) —
 * this is what a human pastes into either `ecosystem-research-update-skill.md`'s or
 * `portfolio-research-update-skill.md`'s prompt so a free web-research agent references EXISTING
 * companies/reactors/materials by their real ids instead of minting duplicates.
 * Tracked-portfolio entities are suffixed `[PORTFOLIO]` (see `../src/scope.ts`) so either skill
 * can see the ecosystem/portfolio split at a glance.
 *
 * Usage: yarn workspace @quant-fusion/research-fusion run list:entities
 */
import { createFusionFixtureDataset } from '../src/fixture.js';
import { isPortfolioEntity } from '../src/scope.js';

function main(): void {
  const dataset = createFusionFixtureDataset();
  const sorted = [...dataset.entities].sort((a, b) => a.id.localeCompare(b.id));
  for (const entity of sorted) {
    const tag = isPortfolioEntity(entity.id) ? ' [PORTFOLIO]' : '';
    console.log(`${entity.id} — ${entity.name}${tag}`);
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
