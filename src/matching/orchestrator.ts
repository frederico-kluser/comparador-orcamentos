import Fuse from 'fuse.js';
import type { OrderItem, SupplierLineItem, UnmatchedItem } from '@/types';
import { normalizar } from '@/matching/normalize';
import { findCachedMatch, saveLearnedMatch } from '@/db/schema';
import { callLLMMatch, isLLMConfigured } from '@/matching/llmClient';

const FUZZY_AUTO_THRESHOLD = 0.15;
const FUZZY_AMBIGUITY_THRESHOLD = 0.05;
const LLM_AUTO_CONFIDENCE = 0.85;

export interface MatchOutcome {
  matched: boolean;
  productId?: string;
  source?: SupplierLineItem['matchSource'];
  score?: number;
  // se não matchou, candidatos para o modal
  candidates?: { id: string; descricao: string; score: number }[];
}

/**
 * Cascata de matching para um único item do fornecedor:
 *   1) cache (IndexedDB)
 *   2) fuzzy (Fuse.js)
 *   3) LLM (se configurado)
 *   4) sinaliza para revisão manual
 */
export async function matchItem(
  rawTerm: string,
  catalogo: OrderItem[],
  productListHash: string
): Promise<MatchOutcome> {
  const norm = normalizar(rawTerm);
  if (!norm) {
    return { matched: false, candidates: [] };
  }

  // 1) Cache
  const cached = await findCachedMatch(norm, productListHash);
  if (cached && cached.confirmed_count >= 1) {
    // valida que o produto ainda existe na ordem
    const stillExists = catalogo.some((c) => c.id === cached.canonical_product_id);
    if (stillExists) {
      // bumpa o last_used_at sem incrementar count
      await saveLearnedMatch({
        normalized_supplier_term: norm,
        raw_supplier_term: rawTerm,
        product_list_hash: productListHash,
        canonical_product_id: cached.canonical_product_id,
        canonical_product_name: cached.canonical_product_name,
        confidence: cached.confidence,
        source: cached.source,
        confirmed_count: 0, // saveLearnedMatch incrementa só se já existe
        created_at: cached.created_at,
        last_used_at: Date.now(),
      });
      return {
        matched: true,
        productId: cached.canonical_product_id,
        source: 'cache',
        score: cached.confidence,
      };
    }
  }

  // 2) Fuzzy
  const fuse = new Fuse(catalogo, {
    keys: [{ name: 'descricaoNormalizada', weight: 1 }],
    ignoreDiacritics: true,
    includeScore: true,
    threshold: 0.5,
    minMatchCharLength: 3,
    ignoreLocation: true,
  });

  const fuzzyHits = fuse.search(norm).slice(0, 5);
  const candidatesForModal = fuzzyHits.map((h) => ({
    id: h.item.id,
    descricao: h.item.descricao,
    score: h.score ?? 1,
  }));

  if (fuzzyHits.length > 0) {
    const best = fuzzyHits[0];
    const second = fuzzyHits[1];
    const isAmbiguous = second && (second.score! - best.score!) < FUZZY_AMBIGUITY_THRESHOLD;
    if (best.score! <= FUZZY_AUTO_THRESHOLD && !isAmbiguous) {
      return {
        matched: true,
        productId: best.item.id,
        source: 'fuzzy',
        score: best.score,
      };
    }
  }

  // 3) LLM (se configurado e há candidatos)
  if (isLLMConfigured() && fuzzyHits.length > 0) {
    try {
      const llmResult = await callLLMMatch(
        rawTerm,
        fuzzyHits.map((h) => ({ id: h.item.id, descricao: h.item.descricao }))
      );
      if (llmResult.chosenId !== 'none' && llmResult.confidence >= LLM_AUTO_CONFIDENCE) {
        // grava no cache mas como source='llm' (pode ser revisado pelo humano depois)
        const product = catalogo.find((c) => c.id === llmResult.chosenId);
        if (product) {
          await saveLearnedMatch({
            normalized_supplier_term: norm,
            raw_supplier_term: rawTerm,
            product_list_hash: productListHash,
            canonical_product_id: product.id,
            canonical_product_name: product.descricao,
            confidence: llmResult.confidence,
            source: 'llm',
            confirmed_count: 0, // ainda não foi confirmado por humano
            created_at: Date.now(),
            last_used_at: Date.now(),
          });
          return {
            matched: true,
            productId: product.id,
            source: 'llm',
            score: llmResult.confidence,
          };
        }
      }
    } catch (e) {
      console.warn('LLM falhou para item, indo para revisão manual:', e);
    }
  }

  // 4) Manual
  return {
    matched: false,
    candidates: candidatesForModal,
  };
}

/** Confirma manualmente um match e grava no cache de aprendizado. */
export async function confirmManualMatch(
  rawTerm: string,
  productId: string,
  productName: string,
  productListHash: string
): Promise<void> {
  const norm = normalizar(rawTerm);
  await saveLearnedMatch({
    normalized_supplier_term: norm,
    raw_supplier_term: rawTerm,
    product_list_hash: productListHash,
    canonical_product_id: productId,
    canonical_product_name: productName,
    confidence: 1,
    source: 'human',
    confirmed_count: 1,
    created_at: Date.now(),
    last_used_at: Date.now(),
  });
}
