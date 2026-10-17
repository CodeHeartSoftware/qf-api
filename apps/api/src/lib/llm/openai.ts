const OPENAI_BASE_URL = 'https://api.openai.com/v1';

// Prefix allowlist, not a denylist — OpenAI's `/v1/models` also lists embedding, audio/whisper,
// TTS, image, and legacy completion models that would silently break `chat()`'s JSON-object
// contract; an allowlist of known CHAT-capable families is the safer default (a model this misses
// just doesn't show up in the picker yet, rather than a wrong pick throwing at request time).
// Update this list as OpenAI ships new chat model families.
const CHAT_MODEL_PREFIXES = ['gpt-5', 'gpt-4.1', 'gpt-4o', 'chatgpt-4o', 'o1', 'o3', 'o4'];

interface OpenAiModelsResponse {
  data: { id: string; created: number }[];
}

interface OpenAiChatResponse {
  choices: { message: { role: string; content: string } }[];
}

function isChatModel(id: string): boolean {
  return CHAT_MODEL_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** Every chat-capable model this OpenAI account can use, newest first — never hardcoded to one
 * model id, the same "ask the real API" convention `lib/llm/ollama.ts` already follows. Throws on
 * an invalid/missing key so the caller (the News Research Agent's model list) can surface that
 * plainly rather than silently returning an empty list indistinguishable from "no chat models". */
export async function listModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${OPENAI_BASE_URL}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI /v1/models failed with status ${String(res.status)}: ${text}`);
  }
  const body = (await res.json()) as OpenAiModelsResponse;
  return body.data
    .filter((m) => isChatModel(m.id))
    .sort((a, b) => b.created - a.created)
    .map((m) => m.id);
}

/** One non-streaming chat turn via the Chat Completions API — `response_format: json_object`
 * mirrors Ollama's `format: 'json'` in `ollama.ts`'s own `chat()`, the same contract every caller
 * in `newsAgent.ts` already relies on. OpenAI requires the word "json" to appear in the prompt
 * for this response format; every system prompt this app sends already says "Return ONLY a JSON
 * object", so that's satisfied without special-casing here. */
export async function chat(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `OpenAI /v1/chat/completions failed with status ${String(res.status)}: ${text}`,
    );
  }
  const body = (await res.json()) as OpenAiChatResponse;
  const content = body.choices[0]?.message.content;
  if (content === undefined) {
    throw new Error('OpenAI /v1/chat/completions returned no choices.');
  }
  return content;
}
