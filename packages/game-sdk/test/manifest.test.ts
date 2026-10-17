import { describe, expect, it } from 'vitest';
import { GameManifestSchema, parseGameManifest } from '../src/manifest.js';

const validManifest = {
  id: 'rock-paper-scissors',
  name: 'Rock Paper Scissors',
  version: '1.0.0',
  entryPackage: '@quant-fusion/game-rock-paper-scissors',
  protocolVersion: '^1.0',
  minParticipants: 2,
  maxParticipants: 2,
  maintainers: [{ name: 'Jane Doe', contact: 'jane@example.com' }],
};

describe('GameManifestSchema', () => {
  it('accepts a valid manifest', () => {
    expect(parseGameManifest(validManifest).success).toBe(true);
  });

  it('rejects maxParticipants < minParticipants', () => {
    const result = GameManifestSchema.safeParse({
      ...validManifest,
      minParticipants: 4,
      maxParticipants: 2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing maintainers list', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitting the field is the point
    const { maintainers, ...withoutMaintainers } = validManifest;
    const result = GameManifestSchema.safeParse(withoutMaintainers);
    expect(result.success).toBe(false);
  });

  it('rejects a non-kebab-case id', () => {
    const result = GameManifestSchema.safeParse({ ...validManifest, id: 'RockPaperScissors' });
    expect(result.success).toBe(false);
  });
});
