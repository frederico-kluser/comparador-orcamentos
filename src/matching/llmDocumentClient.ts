import { z } from 'zod';
import { callOpenAICompatJSONStream } from './llmStream';

/**
 * LLM em modo "uma request por documento":
 * envia TODOS os items ainda não identificados de um fornecedor + o catálogo
 * canônico, e recebe os matches em uma única chamada.
 *
 * Modelo padrão: deepseek-v4-pro (override via VITE_DEEPSEEK_MODEL_MATCH).
 */

const MatchRowSchema = z.object({
  itemId: z.string(),
  productId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const MatchResponseSchema = z.object({
  matches: z.array(MatchRowSchema),
});

export type DocumentMatchResponse = z.infer<typeof MatchResponseSchema>;

const SYSTEM_PROMPT = `Você é um assistente especializado em correspondência de produtos em orçamentos comerciais brasileiros (materiais de construção/elétrica). Os itens recebidos JÁ FORAM CLASSIFICADOS por outra etapa (descrição, quantidade e unidade já estão limpos). Sua única tarefa: dada uma lista de termos de itens e uma lista de produtos canônicos da ordem de compra, decidir, para cada termo, qual produto canônico corresponde — ou null se nenhum corresponder claramente.

REGRAS RÍGIDAS:
1. Para cada itemId fornecido, você DEVE retornar exatamente um objeto em "matches" com o mesmo itemId.
2. productId só pode ser um dos IDs do catálogo OU null. NÃO invente IDs.
3. confidence é número de 0.0 a 1.0 refletindo sua certeza.
4. Foque em: descrição técnica, dimensões/bitolas (1/2", 3/4", 1.1/2", M8, 100x100), material (PVC/AÇO/COBRE), código/SKU/NCM se vier no termo, e sinônimos do comércio brasileiro (ex.: "eletroduto" ≈ "eletrod rig", "bucha" ≈ "BUA", "arruela" ≈ "ARA").
5. IGNORE pequenas variações de unidade entre termo e catálogo — a unidade já foi classificada. Concentre-se na identidade do produto.
6. Se o termo não tem correspondente claro, retorne productId=null com confidence baixa.

FORMATO DE SAÍDA: APENAS JSON, sem texto antes ou depois, com este shape exato:
{"matches":[{"itemId":"...","productId":"..."|null,"confidence":0.0}]}`;

const LLM_AUTO_CONFIDENCE = 0.85;

export async function callDocumentMatchLLM(
  unmatchedItems: { id: string; rawTerm: string }[],
  catalogo: { id: string; descricao: string }[]
): Promise<DocumentMatchResponse> {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY;
  const baseUrl = import.meta.env.VITE_DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = import.meta.env.VITE_DEEPSEEK_MODEL_MATCH || 'deepseek-v4-pro';

  if (!apiKey || apiKey.includes('xxxxxxxx')) {
    throw new Error(
      'VITE_DEEPSEEK_API_KEY não configurada. Crie um .env com base em .env.example.'
    );
  }

  const userMessage =
    `CATÁLOGO (produtos canônicos da ordem de compra):\n` +
    catalogo.map((c) => `- id: "${c.id}" | desc: "${c.descricao}"`).join('\n') +
    `\n\nITENS DO ORÇAMENTO PARA IDENTIFICAR:\n` +
    unmatchedItems.map((it) => `- itemId: "${it.id}" | termo: "${it.rawTerm}"`).join('\n') +
    `\n\nResponda em JSON com {"matches":[...]} contendo um objeto por itemId acima.`;

  const content = await callOpenAICompatJSONStream({
    apiKey,
    baseUrl,
    model,
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: Math.max(2000, Math.min(16000, 200 + unmatchedItems.length * 80)),
    logTag: '[match]',
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM não retornou JSON válido.');
    parsed = JSON.parse(m[0]);
  }

  const validated = MatchResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error('Schema de resposta LLM inválido: ' + validated.error.message);
  }

  // sanitiza: productId precisa estar no catálogo
  const validIds = new Set(catalogo.map((c) => c.id));
  const sentItemIds = new Set(unmatchedItems.map((u) => u.id));
  const cleaned = validated.data.matches
    .filter((m) => sentItemIds.has(m.itemId))
    .map((m) => ({
      ...m,
      productId: m.productId && validIds.has(m.productId) ? m.productId : null,
    }));

  return { matches: cleaned };
}

export function isLLMConfigured(): boolean {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY;
  return !!apiKey && !apiKey.includes('xxxxxxxx');
}

export const LLM_AUTO_CONFIDENCE_THRESHOLD = LLM_AUTO_CONFIDENCE;
