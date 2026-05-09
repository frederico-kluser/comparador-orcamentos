import { z } from 'zod';
import { callOpenAICompatJSONStream } from './llmStream';
import { CLASSIFY_ORDER_SYSTEM_PROMPT } from './prompts';

/**
 * Stage 1 da LISTA MESTRE: recebe o texto bruto do .docx/.pdf/.txt do usuário
 * e devolve a lista limpa de itens canônicos (sem cabeçalhos de seção, totais,
 * etc). Ver PLANO_PICA.md §4 (passo 0).
 */

const OrderClassifiedItemSchema = z.object({
  nome: z.string().min(1),
  quantidade: z.number().nullable(),
  unidade: z.string().nullable(),
});

const OrderClassifyResponseSchema = z.object({
  items: z.array(OrderClassifiedItemSchema),
});

export type OrderClassifiedItem = z.infer<typeof OrderClassifiedItemSchema>;
export type OrderClassifyResponse = z.infer<typeof OrderClassifyResponseSchema>;

export async function classifyOrderLLM(
  rawText: string,
  fileName: string
): Promise<OrderClassifyResponse> {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY;
  const baseUrl = import.meta.env.VITE_DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = import.meta.env.VITE_DEEPSEEK_MODEL_CLASSIFY || 'deepseek-v4-flash';

  if (!apiKey || apiKey.includes('xxxxxxxx')) {
    throw new Error(
      'VITE_DEEPSEEK_API_KEY não configurada. Crie um .env com base em .env.example.'
    );
  }

  // Lista mestre raramente é gigante; mantemos a janela cheia (60k chars) para
  // não cortar itens. Se for maior, mantemos cabeça e cauda.
  const MAX_CHARS = 60_000;
  const trimmed =
    rawText.length > MAX_CHARS
      ? rawText.slice(0, MAX_CHARS / 2) +
        '\n[...corte de texto...]\n' +
        rawText.slice(-MAX_CHARS / 2)
      : rawText;

  const userMessage =
    `Arquivo: ${fileName}\n\n` +
    `TEXTO BRUTO DA LISTA MESTRE:\n` +
    `<<<\n${trimmed}\n>>>\n\n` +
    `Devolva o JSON {"items":[...]} conforme as regras.`;

  const content = await callOpenAICompatJSONStream({
    apiKey,
    baseUrl,
    model,
    systemPrompt: CLASSIFY_ORDER_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 16000,
    logTag: '[classify-order]',
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM não retornou JSON válido na limpeza da lista mestre.');
    parsed = JSON.parse(m[0]);
  }

  const validated = OrderClassifyResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      'Schema da limpeza da lista mestre inválido: ' + validated.error.message
    );
  }

  return validated.data;
}
