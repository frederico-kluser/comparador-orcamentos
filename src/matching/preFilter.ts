import Fuse from 'fuse.js';
import type { OrderItem } from '../types';
import { normalizar } from './normalize';

/**
 * Pré-filtro lexical sobre a lista mestre (fuse.js).
 *
 * Objetivo: para cada termo de proposta, devolver os top-K candidatos da
 * lista mestre por similaridade lexical. Reduz drasticamente o contexto
 * enviado ao LLM matcher (Stage 2) sem comprometer recall.
 *
 * Não decide nada. Threshold solto (0.6) prioriza recall — preferimos sobrar
 * candidatos do que cortar o correto.
 *
 * Ver PLANO_PICA.md §5.1.2.
 */

export interface PreFilterCandidate {
  id: string;
  descricao: string;
  score: number; // 0..1 (fuse.js: 0 = match perfeito, 1 = sem similaridade)
}

export function buildMasterIndex(master: OrderItem[]) {
  return new Fuse(master, {
    keys: [
      { name: 'descricao', weight: 0.4 },
      { name: 'descricaoNormalizada', weight: 0.6 },
    ],
    threshold: 0.6,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2,
    distance: 200,
  });
}

export function topKCandidates(
  proposalTerm: string,
  fuseIndex: Fuse<OrderItem>,
  k = 10
): PreFilterCandidate[] {
  const variants = uniq([proposalTerm, normalizar(proposalTerm)]).filter(Boolean);

  const merged = new Map<string, PreFilterCandidate>();
  for (const q of variants) {
    const hits = fuseIndex.search(q, { limit: k * 2 });
    for (const h of hits) {
      const prev = merged.get(h.item.id);
      const score = h.score ?? 1;
      if (!prev || score < prev.score) {
        merged.set(h.item.id, {
          id: h.item.id,
          descricao: h.item.descricao,
          score,
        });
      }
    }
  }

  return [...merged.values()].sort((a, b) => a.score - b.score).slice(0, k);
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
