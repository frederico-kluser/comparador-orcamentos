import Decimal from 'decimal.js';
import type { PurchaseOrder, RankedProposal, SupplierQuote } from '../types';
import { buildComparison } from './calculator';
import { callOpenAICompatJSONStream } from '../matching/llmStream';
import { RANKING_JUSTIFICATION_SYSTEM_PROMPT } from '../matching/prompts';
import { getOpenRouterConfig, isLLMConfigured } from '../matching/openRouterConfig';
import { z } from 'zod';

/**
 * Ranking de propostas: TUDO em JS puro (decimal.js). A IA NUNCA calcula.
 * Ver PLANO_PICA.md §6.
 */

export function rankProposals(
  order: PurchaseOrder,
  suppliers: SupplierQuote[]
): RankedProposal[] {
  if (suppliers.length === 0) return [];

  const cmp = buildComparison(order, suppliers);

  const linhas = suppliers.map((s) => {
    const total = cmp.totals[s.id] ?? new Decimal(0);
    const itensCobertos = order.items.length - (cmp.missingBySupplier[s.id] ?? 0);
    const cobertura = order.items.length === 0 ? 0 : itensCobertos / order.items.length;
    return {
      supplier: s,
      total,
      itensCobertos,
      cobertura,
    };
  });

  // Ordena ASC por total; desempate: maior cobertura; depois nome A-Z
  linhas.sort((a, b) => {
    const dt = a.total.cmp(b.total);
    if (dt !== 0) return dt;
    if (a.cobertura !== b.cobertura) return b.cobertura - a.cobertura;
    return a.supplier.supplierName.localeCompare(b.supplier.supplierName);
  });

  const melhorTotal = linhas[0].total;

  return linhas.map((l, idx) => {
    const delta = l.total.minus(melhorTotal);
    const deltaPct = melhorTotal.isZero() ? 0 : delta.div(melhorTotal).toNumber();
    return {
      rank: idx + 1,
      supplierId: l.supplier.id,
      supplierName: l.supplier.supplierName,
      total: l.total.toFixed(2),
      itens_cobertos: l.itensCobertos,
      itens_total_master: order.items.length,
      cobertura: l.cobertura,
      delta_vs_melhor: delta.toFixed(2),
      delta_vs_melhor_pct: deltaPct,
      justificativa_ia: '',
    };
  });
}

const JustificativasSchema = z.object({
  justificativas: z.array(z.string()),
});

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function fmtBRL(value: string): string {
  return BRL.format(Number(value));
}

function fmtPct(p: number): string {
  return (p * 100).toFixed(1).replace('.', ',') + '%';
}

/**
 * Gera justificativas via LLM. A IA recebe os números formatados e DEVE só
 * citar valores idênticos aos da entrada — validamos via regex.
 *
 * Em caso de falha (sem LLM, erro, IA inventou número), cai pra template JS.
 */
export async function generateRankingJustifications(
  ranking: RankedProposal[]
): Promise<string[]> {
  if (ranking.length === 0) return [];

  const propostas = ranking.map((r) => ({
    rank: r.rank,
    supplier: r.supplierName,
    total: fmtBRL(r.total),
    cobertura: fmtPct(r.cobertura),
    delta_vs_melhor: fmtBRL(r.delta_vs_melhor),
    delta_pct: fmtPct(r.delta_vs_melhor_pct),
    itens_cobertos: r.itens_cobertos,
    itens_total: r.itens_total_master,
  }));

  const fallback = ranking.map((r) => fallbackJustificativa(r));

  if (!isLLMConfigured()) return fallback;

  try {
    const cfg = getOpenRouterConfig();
    const content = await callOpenAICompatJSONStream({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      systemPrompt: RANKING_JUSTIFICATION_SYSTEM_PROMPT,
      userMessage: JSON.stringify({ propostas }),
      maxTokens: 2000,
      reasoningEffort: 'minimal', // só formata texto a partir de números prontos
      httpReferer: cfg.httpReferer,
      appTitle: cfg.appTitle,
      logTag: '[ranking-justify]',
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('JSON inválido');
      parsed = JSON.parse(m[0]);
    }

    const validated = JustificativasSchema.safeParse(parsed);
    if (!validated.success) throw new Error('Schema inválido');
    if (validated.data.justificativas.length !== ranking.length) {
      throw new Error('Quantidade de justificativas não bate');
    }

    // Validação anti-alucinação: cada R$ citado pela IA tem que existir na entrada.
    const allowedNumericTokens = new Set<string>();
    for (const p of propostas) {
      allowedNumericTokens.add(p.total);
      allowedNumericTokens.add(p.delta_vs_melhor);
      allowedNumericTokens.add(p.cobertura);
      allowedNumericTokens.add(p.delta_pct);
      allowedNumericTokens.add(String(p.itens_cobertos));
      allowedNumericTokens.add(String(p.itens_total));
    }

    return validated.data.justificativas.map((txt, idx) => {
      if (containsForbiddenNumber(txt, allowedNumericTokens)) {
        // eslint-disable-next-line no-console
        console.warn('[ranking-justify] IA citou número fora da entrada — fallback', txt);
        return fallback[idx];
      }
      return txt;
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[ranking-justify] falhou, usando template:', e);
    return fallback;
  }
}

function fallbackJustificativa(r: RankedProposal): string {
  if (r.rank === 1) {
    return `Posição ${r.rank} com ${fmtPct(r.cobertura)} de cobertura (${r.itens_cobertos}/${r.itens_total_master} itens) e total de ${fmtBRL(r.total)} — referência do ranking.`;
  }
  return `Posição ${r.rank}: ${fmtBRL(r.total)} (cobertura ${fmtPct(r.cobertura)}, ${r.itens_cobertos}/${r.itens_total_master} itens), ${fmtBRL(r.delta_vs_melhor)} acima do menor total (${fmtPct(r.delta_vs_melhor_pct)}).`;
}

/**
 * Detecta números monetários ou percentuais no texto que NÃO estão entre os
 * valores autorizados. Ignora ordinais ("1º", "primeira") e contagens pequenas
 * já presentes na entrada.
 */
function containsForbiddenNumber(
  text: string,
  allowedTokens: Set<string>
): boolean {
  // Tokens monetários (R$ X) e percentuais (X%) — exigem match exato com a entrada.
  const moneyMatches = text.match(/R\$\s*[\d\.,]+/g) ?? [];
  for (const m of moneyMatches) {
    const compact = m.replace(/\s+/g, ' ').replace(/R\$\s*/, 'R$ ');
    let found = false;
    for (const a of allowedTokens) {
      if (a.replace(/\s+/g, ' ').toLowerCase() === compact.toLowerCase()) {
        found = true;
        break;
      }
    }
    if (!found) return true;
  }

  const pctMatches = text.match(/\d+(?:[.,]\d+)?\s*%/g) ?? [];
  for (const p of pctMatches) {
    const compact = p.replace(/\s+/g, '');
    let found = false;
    for (const a of allowedTokens) {
      if (a.replace(/\s+/g, '') === compact) {
        found = true;
        break;
      }
    }
    if (!found) return true;
  }

  return false;
}
