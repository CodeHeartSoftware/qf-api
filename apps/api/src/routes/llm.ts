import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { listAvailableModels } from '../lib/llm/index.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Not domain-scoped like `research.ts` — which models are available has nothing to do with any
 * one research domain. Backs the News Research Agent modal's model picker; see `lib/llm/index.ts`
 * for how Ollama/OpenAI are combined into one provider-tagged list. */
export function createLlmRouter(rootDir: string): Router {
  const router = createRouter();

  router.get('/models', (_req: Request, res: Response) => {
    listAvailableModels(rootDir)
      .then((options) => {
        res.json({ options });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  return router;
}
