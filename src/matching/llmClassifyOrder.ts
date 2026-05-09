import { z } from 'zod';
import { callOpenAICompatJSONStream } from './llmStream';
import { CLASSIFY_ORDER_SYSTEM_PROMPT } from './prompts';
import { chunkText } from './chunkText';
import { runWithLimit } from '../lib/concurrency';

/**
 * Stage 1 da LISTA MESTRE: recebe o texto bruto do .docx/.pdf/.txt/.xlsx do
 * usuário e devolve a lista limpa de itens canônicos (sem cabeçalhos de
 * seção, totais, etc).
 *
 * Documentos longos (>100k chars) são processados em CHUNKS em paralelo
 * (até 3 simultâneos). Os items[] de cada chunk são depois mesclados e
 * deduplicados — isso garante que TODO o conteúdo extraído passa pela LLM,
 * não só o início e o fim. Ver PLANO_PICA.md §4 (passo 0).
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

const CHUNK_THRESHOLD = 100_000;
const CHUNK_SIZE = 80_000;
const CHUNK_OVERLAP_LINES = 5;
const PARALLEL_CHUNKS = 3;

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

  const chunks = chunkText(rawText, CHUNK_SIZE, CHUNK_OVERLAP_LINES);
  if (rawText.length > CHUNK_THRESHOLD) {
    // eslint-disable-next-line no-console
    console.log(
      `[classify-order] documento longo (${rawText.length} chars) — processando em ${chunks.length} chunks paralelos`
    );
  }

  const results = await runWithLimit(chunks, PARALLEL_CHUNKS, async (chunk) => {
    const partOf =
      chunk.total > 1 ? `[parte ${chunk.index + 1}/${chunk.total}] ` : '';
    const userMessage =
      `Arquivo: ${fileName} ${partOf}\n\n` +
      (chunk.total > 1
        ? `Este é o pedaço ${chunk.index + 1} de ${chunk.total} do documento original. ` +
          `Processe APENAS o trecho abaixo. Itens repetidos entre pedaços serão deduplicados depois.\n\n`
        : '') +
      `TEXTO BRUTO DA LISTA MESTRE:\n<<<\n${chunk.text}\n>>>\n\n` +
      `Devolva o JSON {"items":[...]} conforme as regras.`;

    const content = await callOpenAICompatJSONStream({
      apiKey,
      baseUrl,
      model,
      systemPrompt: CLASSIFY_ORDER_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 16000,
      logTag: `[classify-order${chunk.total > 1 ? `:${chunk.index + 1}/${chunk.total}` : ''}]`,
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
    return validated.data.items;
  });

  // Merge + dedupe: chunks com overlap podem repetir itens. Um item é
  // duplicado se nome (case+trim insensitive) + quantidade + unidade batem.
  const merged: OrderClassifiedItem[] = [];
  const seen = new Set<string>();
  for (const list of results) {
    for (const it of list) {
      const key = dedupeKey(it.nome, it.quantidade, it.unidade);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(it);
    }
  }
  return { items: merged };
}

function dedupeKey(
  nome: string,
  quantidade: number | null,
  unidade: string | null
): string {
  const n = (nome || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const q = quantidade == null ? '∅' : String(quantidade);
  const u = (unidade || '').trim().toLowerCase();
  return `${n}|${q}|${u}`;
}
