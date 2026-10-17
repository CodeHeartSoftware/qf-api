// Builds a bot's Docker image on demand from its manifest's `build` config
// (docs/adr/0001-monorepo-and-boundary.md §"Manifests" — `build.dockerfile`/`build.context`,
// both defaulted by BotManifestSchema). This is what lets a real match be started from just a
// bot id in the registry — no manual `docker build -t quant-fusion-<id> bots/...` step first.
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface BuildBotImageOptions {
  /** The bot's own directory, as returned by @quant-fusion/registry's BotRegistryEntry.dir. */
  botDir: string;
  /** From the bot's manifest.build.dockerfile (relative to botDir). */
  dockerfile: string;
  /** From the bot's manifest.build.context (relative to botDir). */
  context: string;
  /** Tag to build the image under. */
  imageTag: string;
}

/** Every bot image tag starts with this — also what `cleanup.ts`'s image removal filters on,
 * since built images carry no labels (only containers do; see docker-config.ts). */
export const QUANT_FUSION_BOT_IMAGE_TAG_PREFIX = 'quant-fusion-bot-';

/** The tag convention every caller (CLI, scripts) should use for a registry-resolved bot id. */
export function botImageTag(botId: string): string {
  return `${QUANT_FUSION_BOT_IMAGE_TAG_PREFIX}${botId}`;
}

/**
 * Runs `docker build` for one bot, streaming its output to this process's own stdout/stderr
 * (build output can be slow and is worth watching live, exactly like running `docker build`
 * yourself would be). Resolves with `imageTag` on success.
 */
export async function buildBotImage(options: BuildBotImageOptions): Promise<string> {
  const { botDir, dockerfile, context, imageTag } = options;
  const contextPath = path.resolve(botDir, context);
  const dockerfilePath = path.resolve(botDir, dockerfile);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('docker', ['build', '-t', imageTag, '-f', dockerfilePath, contextPath], {
      stdio: 'inherit',
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker build failed (exit code ${String(code)}) for "${imageTag}"`));
      }
    });
  });

  return imageTag;
}
