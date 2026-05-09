import { z } from 'zod';
import type { OrderItem } from '../types';
import { callOpenAICompatJSONStream } from './llmStream';
import { MATCHER_SYSTEM_PROMPT } from './prompts';
import { buildMasterIndex, topKCandidates } from './preFilter';
import { getOpenRouterConfig, isLLMConfigured as orIsLLMConfigured } from './openRouterConfig';

/**
 * Matcher Stage 2 (refac):
 *  - Pré-filtro lexical (fuse.js) reduz a lista mestre a top-K candidatos por termo.
 *  - Uma única request ao LLM por fornecedor, em batch, com extração de specs (CoT)
 *    + few-shot com negativos hard. Ver prompts.ts e PLANO_PICA §5.
 *  - Hard-fail JS pós-resposta: rejeita match com mismatched_specs em campo crítico.
 *  - Saída externa preserva {itemId, productId, confidence} para não quebrar store.
 */

const MatchSpecsSchema = z
  .object({
    categoria: z.string().nullable().optional(),
    material: z.string().nullable().optional(),
    dimensao_principal: z.string().nullable().optional(),
    dimensao_secundaria: z.string().nullable().optional(),
    tensao_nominal: z.string().nullable().optional(),
    corrente_nominal: z.string().nullable().optional(),
    numero_polos: z.string().nullable().optional(),
    acabamento: z.string().nullable().optional(),
    cor: z.string().nullable().optional(),
    marca: z.string().nullable().optional(),
    norma_abnt: z.string().nullable().optional(),
    ncm: z.string().nullable().optional(),
    unidade_comercial: z.string().nullable().optional(),
  })
  .passthrough();

const MatcherDecisionSchema = z.object({
  itemId: z.string(),
  candidate_id: z.string().nullable(),
  decision: z.enum(['match', 'no_match', 'uncertain']),
  confidence: z.number().min(0).max(1),
  specs_proposta: MatchSpecsSchema.optional().default({}),
  specs_master: MatchSpecsSchema.nullable().optional().default(null),
  mismatched_specs: z.array(z.string()).optional().default([]),
  reasoning: z.string().optional().default(''),
});

const MatchResponseSchema = z.object({
  matches: z.array(MatcherDecisionSchema),
});

export type DocumentMatchResponse = {
  matches: Array<{ itemId: string; productId: string | null; confidence: number }>;
};

const LLM_AUTO_CONFIDENCE = 0.85;

const HARD_FAIL_FIELDS = new Set([
  'dimensao_principal',
  'dimensao_secundaria',
  'tensao_nominal',
  'corrente_nominal',
  'numero_polos',
  'categoria',
  'material',
  'acabamento',
]);

/**
 * Cinto + suspensório: mesmo se o LLM violar a regra, o JS rejeita o match
 * quando há divergência em campo crítico. Para "cor" só vale como hard-fail
 * se a categoria for cabo (cor em cabo é load-bearing).
 */
function violatesHardFail(d: z.infer<typeof MatcherDecisionSchema>): boolean {
  const mismatched = d.mismatched_specs ?? [];
  for (const f of mismatched) {
    if (HARD_FAIL_FIELDS.has(f)) return true;
  }
  if (mismatched.includes('cor')) {
    const cat = (d.specs_proposta?.categoria ?? '').toString().toLowerCase();
    if (cat.includes('cabo')) return true;
  }
  return false;
}

export async function callDocumentMatchLLM(
  unmatchedItems: { id: string; rawTerm: string }[],
  catalogo: OrderItem[]
): Promise<DocumentMatchResponse> {
  if (unmatchedItems.length === 0) return { matches: [] };
  const cfg = getOpenRouterConfig();

  // Pré-filtro: para cada item, top-10 candidatos da master
  const fuseIndex = buildMasterIndex(catalogo);
  const itemsWithCandidates = unmatchedItems.map((it) => ({
    ...it,
    candidates: topKCandidates(it.rawTerm, fuseIndex, 10),
  }));

  // Monta o user message: cada item com sua sublista de candidatos
  const userMessage =
    `Para cada item abaixo, escolha UM candidate_id da sua lista de CANDIDATOS — ou null se nenhum for compatível conforme as regras hard-fail.\n\n` +
    itemsWithCandidates
      .map((it) => {
        const candList =
          it.candidates.length === 0
            ? '  (sem candidatos pré-filtrados — responda no_match)'
            : it.candidates
                .map((c) => `  - id:"${c.id}" desc:"${c.descricao}"`)
                .join('\n');
        return (
          `ITEM\n` +
          `  itemId:"${it.id}"\n` +
          `  termo:"${it.rawTerm}"\n` +
          `  CANDIDATOS:\n${candList}`
        );
      })
      .join('\n\n') +
    `\n\nResponda em JSON {"matches":[...]} com UM objeto por itemId acima, na mesma ordem.`;

  const content = await callOpenAICompatJSONStream({
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    systemPrompt: MATCHER_SYSTEM_PROMPT,
    userMessage,
    maxTokens: Math.max(4000, Math.min(32000, 800 + unmatchedItems.length * 400)),
    reasoningEffort: 'medium', // matcher se beneficia de CoT — extrai specs antes de decidir
    httpReferer: cfg.httpReferer,
    appTitle: cfg.appTitle,
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

  const validIds = new Set(catalogo.map((c) => c.id));
  const sentItemIds = new Set(unmatchedItems.map((u) => u.id));

  const cleaned = validated.data.matches
    .filter((m) => sentItemIds.has(m.itemId))
    .map((m) => {
      // Hard-fail JS (cinto + suspensório): se o LLM disse "match" mas existe
      // divergência crítica, rebaixamos para no_match.
      const hardFail = violatesHardFail(m);
      const finalDecision = hardFail && m.decision === 'match' ? 'no_match' : m.decision;
      const candidateOk =
        m.candidate_id && validIds.has(m.candidate_id) && finalDecision === 'match';

      return {
        itemId: m.itemId,
        productId: candidateOk ? (m.candidate_id as string) : null,
        confidence: candidateOk ? m.confidence : 0,
      };
    });

  return { matches: cleaned };
}

export const isLLMConfigured = orIsLLMConfigured;

export const LLM_AUTO_CONFIDENCE_THRESHOLD = LLM_AUTO_CONFIDENCE;
