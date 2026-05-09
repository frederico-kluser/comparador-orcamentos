import { z } from 'zod';
import { callOpenAICompatJSONStream } from './llmStream';
import { CLASSIFY_SYSTEM_PROMPT } from './prompts';
import { chunkText } from './chunkText';
import { runWithLimit } from '../lib/concurrency';

/**
 * Stage 1 da PROPOSTA: lê o texto bruto e devolve {supplierName, items[]}.
 *
 * Documentos longos (>100k chars) são processados em CHUNKS em paralelo
 * (até 3 simultâneos). supplierName é tirado do primeiro chunk que devolver
 * algo não-vazio (cabeçalho do fornecedor geralmente está na 1ª página).
 * Items[] são mesclados e deduplicados — todo o conteúdo passa pela LLM,
 * sem cortar o meio do documento.
 */

const ClassifiedItemSchema = z.object({
  rawTerm: z.string().min(1),
  quantidade: z.number().nonnegative(),
  unidadeAbrev: z.string().nullable(),
  unidadeHumana: z.string().min(1),
  valorUnit: z.string(),
  valorTotal: z.string(),
  isPromocao: z.boolean(),
});

const ClassifyResponseSchema = z.object({
  // tolerante a vazio: documentos sem razão social (planilhas simples,
  // listas internas) caem no fallback de filename feito no chamador.
  supplierName: z.string(),
  items: z.array(ClassifiedItemSchema),
});

export type ClassifiedItem = z.infer<typeof ClassifiedItemSchema>;
export type ClassifyResponse = z.infer<typeof ClassifyResponseSchema>;

const CHUNK_THRESHOLD = 100_000;
const CHUNK_SIZE = 80_000;
const CHUNK_OVERLAP_LINES = 5;
const PARALLEL_CHUNKS = 3;

export async function classifyDocumentLLM(
  rawText: string,
  fileName: string
): Promise<ClassifyResponse> {
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
      `[classify] documento longo (${rawText.length} chars) — processando em ${chunks.length} chunks paralelos`
    );
  }

  const partial = await runWithLimit(chunks, PARALLEL_CHUNKS, async (chunk) => {
    const userMessage =
      `Arquivo: ${fileName}\n\n` +
      (chunk.total > 1
        ? `Este é o pedaço ${chunk.index + 1} de ${chunk.total} do documento original. ` +
          `Processe APENAS o trecho abaixo. Itens repetidos entre pedaços serão deduplicados depois. ` +
          `O nome do fornecedor (supplierName) só precisa vir uma vez — pode ser string vazia se não estiver visível neste pedaço.\n\n`
        : '') +
      `TEXTO BRUTO DO DOCUMENTO:\n<<<\n${chunk.text}\n>>>\n\n` +
      `Devolva o JSON conforme as regras.`;

    const content = await callOpenAICompatJSONStream({
      apiKey,
      baseUrl,
      model,
      systemPrompt: CLASSIFY_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 16000,
      logTag: `[classify${chunk.total > 1 ? `:${chunk.index + 1}/${chunk.total}` : ''}]`,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('LLM não retornou JSON válido na classificação.');
      parsed = JSON.parse(m[0]);
    }
    const validated = ClassifyResponseSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error('Schema da classificação LLM inválido: ' + validated.error.message);
    }
    return validated.data;
  });

  // supplierName: primeiro chunk com string não-vazia ganha (em ordem natural).
  const supplierName = partial.find((p) => p.supplierName.trim().length > 0)?.supplierName ?? '';

  // Merge + dedupe dos items: chave = rawTerm normalizado + quantidade + valorUnit.
  const merged: ClassifiedItem[] = [];
  const seen = new Set<string>();
  for (const p of partial) {
    for (const it of p.items) {
      const key = dedupeItemKey(it);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(it);
    }
  }

  return { supplierName, items: merged };
}

function dedupeItemKey(it: ClassifiedItem): string {
  const t = (it.rawTerm || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const q = it.quantidade ?? 0;
  const v = (it.valorUnit || '').trim();
  return `${t}|${q}|${v}`;
}
