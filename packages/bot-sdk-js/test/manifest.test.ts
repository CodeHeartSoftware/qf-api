import { describe, expect, it } from 'vitest';
import { BotManifestSchema, parseBotManifest } from '../src/manifest.js';

const validManifest = {
  id: 'random-rps',
  name: 'Random RPS',
  version: '1.0.0',
  game: 'rock-paper-scissors',
  author: { name: 'Jane Doe', contact: 'jane@example.com' },
  runtime: { language: 'node' as const },
  interface: { transport: 'stdio' as const },
  protocolVersion: '^1.0',
};

describe('BotManifestSchema', () => {
  it('accepts a minimal valid manifest and applies build defaults', () => {
    const result = parseBotManifest(validManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.build).toEqual({ dockerfile: 'Dockerfile', context: '.' });
    }
  });

  it('rejects a non-kebab-case id', () => {
    const result = BotManifestSchema.safeParse({ ...validManifest, id: 'Random_RPS' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-semver version', () => {
    const result = BotManifestSchema.safeParse({ ...validManifest, version: 'v1' });
    expect(result.success).toBe(false);
  });

  it('rejects an http transport (stdio-only in v1)', () => {
    const result = BotManifestSchema.safeParse({
      ...validManifest,
      interface: { transport: 'http' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing author', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitting the field is the point
    const { author, ...withoutAuthor } = validManifest;
    const result = BotManifestSchema.safeParse(withoutAuthor);
    expect(result.success).toBe(false);
  });

  it('accepts an explicit resources request without treating it as authoritative', () => {
    const result = parseBotManifest({
      ...validManifest,
      resources: { cpu: 1, memoryMb: 256, timeoutMs: 5000 },
    });
    expect(result.success).toBe(true);
  });
});
