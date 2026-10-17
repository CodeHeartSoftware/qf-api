import { z } from 'zod';

/**
 * Game manifest schema (docs/adr/0001-monorepo-and-boundary.md §"Manifests").
 *
 * Games are real Yarn workspace members and are maintainer/steward-reviewed, but the registry
 * still discovers them by scanning manifest.json — no hand-maintained central index.
 */

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const SEMVER_RANGE = /^[\^~]?\d+(\.\d+){0,2}(\.x)?$|^\*$/;

export const GameManifestSchema = z
  .object({
    id: z.string().regex(KEBAB_CASE, 'id must be kebab-case'),
    name: z.string().min(1),
    version: z.string().regex(SEMVER, 'version must be semver (major.minor.patch)'),
    // A registry-driven caller (@quant-fusion/registry consumers) dynamically imports this
    // package and reads its `game` named export as the GameDefinition — see
    // games/rock-paper-scissors/src/index.ts for the convention every game's entrypoint follows.
    entryPackage: z.string().min(1),
    protocolVersion: z.string().regex(SEMVER_RANGE, 'protocolVersion must be a semver range'),
    minParticipants: z.number().int().positive(),
    maxParticipants: z.number().int().positive(),
    deterministic: z.boolean().optional(),
    supportedTournamentFormats: z.array(z.string()).optional(),
    maintainers: z
      .array(
        z.object({
          name: z.string().min(1),
          contact: z.string().min(1),
        }),
      )
      .min(1),
    description: z.string().optional(),
    license: z.string().optional(),
  })
  .refine((manifest) => manifest.maxParticipants >= manifest.minParticipants, {
    message: 'maxParticipants must be >= minParticipants',
    path: ['maxParticipants'],
  });

export type GameManifest = z.infer<typeof GameManifestSchema>;

export function parseGameManifest(raw: unknown): z.SafeParseReturnType<unknown, GameManifest> {
  return GameManifestSchema.safeParse(raw);
}
