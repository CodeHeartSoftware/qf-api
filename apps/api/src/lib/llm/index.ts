import { getSettings } from '../settingsStore.js';
import * as ollama from './ollama.js';
import * as openai from './openai.js';

export type LlmProvider = 'ollama' | 'openai';

export interface LlmModelOption {
  provider: LlmProvider;
  model: string;
}

/** Every model this app can currently reach, across every configured provider — Ollama is always
 * attempted (best-effort: an unreachable local Ollama just contributes nothing, same as before),
 * OpenAI only when a key is on file (`lib/settingsStore.ts`, set via the Settings tab). Each
 * provider's own failure is caught independently so one being down/misconfigured never hides the
 * other's real models. */
export async function listAvailableModels(rootDir: string): Promise<LlmModelOption[]> {
  const options: LlmModelOption[] = [];

  const ollamaModels = await ollama.listModels().catch(() => []);
  for (const model of ollamaModels) options.push({ provider: 'ollama', model });

  const settings = await getSettings(rootDir);
  if (settings.openaiApiKey !== undefined) {
    const openaiModels = await openai.listModels(settings.openaiApiKey).catch(() => []);
    for (const model of openaiModels) options.push({ provider: 'openai', model });
  }

  return options;
}

/** Dispatches one chat turn to whichever provider `provider` names — the single seam
 * `newsAgent.ts` calls through, so its triage/extraction logic never needs to know which real
 * service is behind a given model id. Throws a clear, specific error for `openai` with no key
 * configured, rather than a confusing downstream 401 from OpenAI itself. */
export async function chat(
  rootDir: string,
  provider: LlmProvider,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  if (provider === 'ollama') return ollama.chat(model, systemPrompt, userPrompt);

  const settings = await getSettings(rootDir);
  if (settings.openaiApiKey === undefined) {
    throw new Error('No OpenAI API key configured — add one in the Settings tab.');
  }
  return openai.chat(settings.openaiApiKey, model, systemPrompt, userPrompt);
}
