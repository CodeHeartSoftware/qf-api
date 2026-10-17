import { z } from 'zod';

/**
 * Bot manifest schema (docs/adr/0001-monorepo-and-boundary.md §"Manifests").
 *
 * Deliberately richer than a bare {id, name, version, game, runtime} — reading a competitor's
 * metadata must never require executing their code, and the registry/runtime/CI boundary-check
 * all need enough here to operate without opening the bot's own source.
 */

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const SEMVER_RANGE = /^[\^~]?\d+(\.\d+){0,2}(\.x)?$|^\*$/;

export const BotRuntimeLanguageSchema = z.enum(['node', 'java', 'other']);

export const BotManifestSchema = z.object({
  id: z.string().regex(KEBAB_CASE, 'id must be kebab-case'),
  name: z.string().min(1),
  version: z.string().regex(SEMVER, 'version must be semver (major.minor.patch)'),
  game: z.string().regex(KEBAB_CASE, 'game must reference a game id (kebab-case)'),
  author: z.object({
    name: z.string().min(1),
    contact: z.string().min(1),
  }),
  runtime: z.object({
    language: BotRuntimeLanguageSchema,
    languageVersion: z.string().min(1).optional(),
  }),
  build: z
    .object({
      dockerfile: z.string().min(1).default('Dockerfile'),
      context: z.string().min(1).default('.'),
    })
    .default({ dockerfile: 'Dockerfile', context: '.' }),
  interface: z.object({
    // stdio (NDJSON) is the only supported transport in v1 (docs/adr/0002-universal-bot-protocol.md).
    transport: z.literal('stdio'),
  }),
  protocolVersion: z.string().regex(SEMVER_RANGE, 'protocolVersion must be a semver range'),
  resources: z
    .object({
      cpu: z.number().positive().optional(),
      memoryMb: z.number().positive().optional(),
      timeoutMs: z.number().positive().optional(),
    })
    .optional(),
  description: z.string().optional(),
  license: z.string().optional(),
});

export type BotManifest = z.infer<typeof BotManifestSchema>;

export function parseBotManifest(raw: unknown): z.SafeParseReturnType<unknown, BotManifest> {
  return BotManifestSchema.safeParse(raw);
}
