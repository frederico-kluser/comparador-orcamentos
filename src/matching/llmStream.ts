/**
 * Cliente OpenAI-compatible (DeepSeek API direto):
 * - streaming SSE (`stream: true`) para resposta em tempo real
 * - desliga thinking via `thinking: { type: "disabled" }` — sintaxe oficial
 *   do DeepSeek V4. Sem isso o modelo gasta tokens em reasoning interno
 *   (vide `reasoning_content` na resposta) e a chamada fica MUITO mais lenta.
 *   https://api-docs.deepseek.com/guides/thinking_mode
 * - força JSON via `response_format: { type: "json_object" }`
 * - logs ao vivo no console (cada chunk delta) para depuração
 *
 * Retorna o conteúdo acumulado já como string JSON pronta para parsing.
 */

export interface LLMStreamOptions {
  apiKey: string;
  baseUrl: string;            // ex.: "https://api.deepseek.com"
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  /** Prefixo no console.log dos chunks (ex.: "[classify]", "[match]"). */
  logTag: string;
}

interface OpenAICompatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
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
    logTag,
  } = opts;

  // eslint-disable-next-line no-console
  console.log(`${logTag} → request`, {
    baseUrl,
    model,
    maxTokens,
    promptChars: userMessage.length,
  });

  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      stream: true,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    // eslint-disable-next-line no-console
    console.error(`${logTag} ✗ HTTP ${resp.status}`, errText.slice(0, 600));
    throw new Error(`DeepSeek HTTP ${resp.status}: ${errText.slice(0, 240)}`);
  }
  if (!resp.body) {
    throw new Error('DeepSeek retornou sem body para streaming.');
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
