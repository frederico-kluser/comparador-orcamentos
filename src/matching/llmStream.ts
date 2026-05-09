/**
 * Cliente OpenAI-compatible (OpenRouter como gateway):
 *  - streaming SSE (`stream: true`).
 *  - força JSON via `response_format: { type: "json_object" }`.
 *  - reasoning configurável via `reasoning: { effort: "minimal"|"low"|"medium"|"high" }`
 *    — quem decide é o caller (matcher pede medium, classify pede low).
 *  - cabeçalhos opcionais HTTP-Referer e X-Title pra atribuição no ranking
 *    público do OpenRouter.
 *  - logs ao vivo no console (cada chunk delta) para depuração.
 *
 * Funciona para qualquer modelo OpenAI-compat hospedado pelo OpenRouter
 * (Gemini, Claude, GPT, Llama). O `reasoning.effort` é traduzido pelo
 * próprio OpenRouter para o param nativo do provider — em Gemini vira
 * `thinkingLevel`, em Claude `thinking.budget_tokens`, em DeepSeek o
 * próprio `thinking`.
 *
 * Referência: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
 */

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface LLMStreamOptions {
  apiKey: string;
  baseUrl: string;            // ex.: "https://openrouter.ai/api/v1"
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  /** Prefixo no console.log dos chunks (ex.: "[classify]", "[match]"). */
  logTag: string;
  /** Atribuição pública (opcional, sem efeito em chamadas privadas). */
  httpReferer?: string;
  appTitle?: string;
}

interface OpenAICompatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
    };
    finish_reason?: string | null;
  }>;
}

export async function callOpenAICompatJSONStream(
  opts: LLMStreamOptions
): Promise<string> {
  const {
    apiKey,
    baseUrl,
    model,
    systemPrompt,
    userMessage,
    maxTokens = 16000,
    reasoningEffort,
    logTag,
    httpReferer,
    appTitle,
  } = opts;

  // eslint-disable-next-line no-console
  console.log(`${logTag} → request`, {
    baseUrl,
    model,
    maxTokens,
    reasoningEffort: reasoningEffort ?? '(default do provider)',
    promptChars: userMessage.length,
  });

  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    Authorization: `Bearer ${apiKey}`,
    Accept: 'text/event-stream',
  };
  if (httpReferer) headers['HTTP-Referer'] = httpReferer;
  if (appTitle) headers['X-Title'] = appTitle;

  const body: Record<string, unknown> = {
    model,
    temperature: 0,
    max_tokens: maxTokens,
    stream: true,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  };
  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    // eslint-disable-next-line no-console
    console.error(`${logTag} ✗ HTTP ${resp.status}`, errText.slice(0, 600));
    throw new Error(`OpenRouter HTTP ${resp.status}: ${errText.slice(0, 240)}`);
  }
  if (!resp.body) {
    throw new Error('OpenRouter retornou sem body para streaming.');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let chunkCount = 0;
  const startedAt = performance.now();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE: linhas separadas por \n\n; cada evento começa com "data: "
    let eventEnd = buffer.indexOf('\n\n');
    while (eventEnd !== -1) {
      const event = buffer.slice(0, eventEnd);
      buffer = buffer.slice(eventEnd + 2);
      eventEnd = buffer.indexOf('\n\n');

      for (const line of event.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let parsed: OpenAICompatStreamChunk;
        try {
          parsed = JSON.parse(payload) as OpenAICompatStreamChunk;
        } catch {
          // eslint-disable-next-line no-console
          console.warn(`${logTag} chunk não-JSON ignorado:`, payload.slice(0, 120));
          continue;
        }

        const delta = parsed.choices?.[0]?.delta;
        const piece = delta?.content;
        if (piece) {
          content += piece;
          chunkCount++;
          // eslint-disable-next-line no-console
          console.log(`${logTag} Δ${chunkCount}`, piece);
        }
      }
    }
  }

  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
  // eslint-disable-next-line no-console
  console.log(
    `${logTag} ✓ stream done — ${chunkCount} chunks, ${content.length} chars, ${elapsed}s`
  );
  // eslint-disable-next-line no-console
  console.log(`${logTag} payload completo:`, content);

  if (!content.trim()) {
    throw new Error('Resposta LLM vazia (streaming).');
  }
  return content;
}
