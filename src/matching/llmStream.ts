/**
 * Cliente OpenRouter compartilhado:
 * - streaming SSE (`stream: true`) para resposta em tempo real
 * - desliga raciocínio (`reasoning: { enabled: false }`) — caro/lento, e o
 *   anúncio oficial do OpenRouter confirma esse parâmetro como o jeito padrão
 *   de desligar thinking em models como MiniMax M2/M2.7
 *   https://x.com/OpenRouterAI/status/1969427723098435738
 * - força JSON via `response_format: { type: "json_object" }`
 * - logs ao vivo no console (cada chunk delta) para depuração
 *
 * Retorna o conteúdo acumulado já como string JSON pronta para parsing.
 */

export interface LLMStreamOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  /** Prefixo no console.log dos chunks (ex.: "[classify]", "[match]"). */
  logTag: string;
}

interface OpenRouterStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string;
      reasoning_content?: string;
    };
    finish_reason?: string | null;
  }>;
}

export async function callOpenRouterJSONStream(
  opts: LLMStreamOptions
): Promise<string> {
  const { apiKey, model, systemPrompt, userMessage, maxTokens = 16000, logTag } = opts;

  // eslint-disable-next-line no-console
  console.log(`${logTag} → request`, {
    model,
    maxTokens,
    promptChars: userMessage.length,
  });

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Comparador de Orcamentos',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      stream: true,
      response_format: { type: 'json_object' },
      reasoning: { enabled: false },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
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

        let parsed: OpenRouterStreamChunk;
        try {
          parsed = JSON.parse(payload) as OpenRouterStreamChunk;
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
