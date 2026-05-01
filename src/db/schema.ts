import Dexie, { type EntityTable } from 'dexie';

export interface LearnedMatch {
  id?: number;
  normalized_supplier_term: string;
  raw_supplier_term: string;
  product_list_hash: string;
  canonical_product_id: string;
  canonical_product_name: string;
  confidence: number;
  source: 'human' | 'llm' | 'fuzzy';
  confirmed_count: number;
  created_at: number;
  last_used_at: number;
}

export const db = new Dexie('CompararOrcamentos') as Dexie & {
  learned_matches: EntityTable<LearnedMatch, 'id'>;
};

db.version(1).stores({
  learned_matches:
    '++id, &[normalized_supplier_term+product_list_hash], canonical_product_id, source, last_used_at',
});

export async function findCachedMatch(
  normalizedTerm: string,
  productListHash: string
): Promise<LearnedMatch | undefined> {
  return db.learned_matches
    .where('[normalized_supplier_term+product_list_hash]')
    .equals([normalizedTerm, productListHash])
    .first();
}

export async function saveLearnedMatch(match: Omit<LearnedMatch, 'id'>): Promise<void> {
  const existing = await findCachedMatch(
    match.normalized_supplier_term,
    match.product_list_hash
  );
  if (existing) {
    await db.learned_matches.update(existing.id!, {
      canonical_product_id: match.canonical_product_id,
      canonical_product_name: match.canonical_product_name,
      confidence: Math.max(existing.confidence, match.confidence),
      source: match.source,
      confirmed_count: existing.confirmed_count + 1,
      last_used_at: Date.now(),
    });
  } else {
    await db.learned_matches.add(match);
  }
}
