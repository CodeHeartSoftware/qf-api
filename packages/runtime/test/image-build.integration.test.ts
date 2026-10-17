import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import { describe, expect, it } from 'vitest';
import { buildBotImage } from '../src/image-build.js';

/**
 * Exercises buildBotImage() against a real Docker daemon and the same minimal-bot fixture used
 * by docker-bot-process.integration.test.ts. Skipped entirely at collection time when no Docker
 * daemon is reachable, matching that suite's convention.
 */
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'minimal-bot');
const IMAGE_TAG = 'quant-fusion-test-image-build:latest';

async function checkDockerAvailable(): Promise<boolean> {
  try {
    await new Docker().ping();
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await checkDockerAvailable();

describe.runIf(dockerAvailable)('buildBotImage (real Docker)', () => {
  it('builds the given directory into a real, inspectable image under the given tag', async () => {
    const returnedTag = await buildBotImage({
      botDir: fixtureDir,
      dockerfile: 'Dockerfile',
      context: '.',
      imageTag: IMAGE_TAG,
    });

    expect(returnedTag).toBe(IMAGE_TAG);
    const docker = new Docker();
    const inspection = await docker.getImage(IMAGE_TAG).inspect();
    expect(inspection.RepoTags).toContain(IMAGE_TAG);
  });

  it('rejects with a clear error when the Dockerfile does not exist', async () => {
    await expect(
      buildBotImage({
        botDir: fixtureDir,
        dockerfile: 'NoSuchDockerfile',
        context: '.',
        imageTag: 'quant-fusion-test-image-build-missing:latest',
      }),
    ).rejects.toThrow('docker build failed');
  });
});
