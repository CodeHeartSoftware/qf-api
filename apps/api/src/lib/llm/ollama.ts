const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

interface OllamaTagsResponse {
  models: { name: string }[];
}

interface OllamaChatResponse {
  message: { role: string; content: string };
}

/** A narrow client for whatever's actually installed in the user's own local Ollama — never a
 * hardcoded model list. Kept to exactly the two calls this app needs (list models, one-shot chat)
 * rather than a general Ollama SDK; if a second local LLM provider is ever added, it becomes a
 * sibling module with the same two-function shape, not a rewrite of this one. */
export async function listModels(): Promise<string[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  if (!res.ok) {
    throw new Error(`Ollama /api/tags failed with status ${String(res.status)}`);
  }
  const body = (await res.json()) as OllamaTagsResponse;
  return body.models.map((m) => m.name);
}

/** One non-streaming chat turn. `format: 'json'` asks Ollama to constrain output to valid JSON —
 * both this feature's LLM calls (triage, per-article extraction) ask for a JSON object back, and
 * a model that free-forms markdown/prose around the JSON would otherwise fail to parse. */
export async function chat(
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama /api/chat failed with status ${String(res.status)}: ${text}`);
  }
  const body = (await res.json()) as OllamaChatResponse;
  return body.message.content;
}
