import type { SupplierLineItem, SupplierQuote } from '@/types';
import { uid } from '@/lib/utils';
import { extractTextFromFile } from '@/lib/extractText';
import { classifyDocumentLLM } from '@/matching/llmClassifyDocument';

/**
 * Parser unificado de PROPOSTA / NOTA do fornecedor.
 * Recebe qualquer formato suportado (.docx, .doc, .pdf, .txt, .xlsx, .xls).
 * 1) extractTextFromFile dá o texto bruto.
 * 2) classifyDocumentLLM extrai itens, valores e nome do fornecedor.
 * 3) Se LLM devolver supplierName vazio (caso comum quando o doc não tem
 *    razão social explícita — ex.: planilha simples), usa filename.
 */
export async function parseSupplierFile(file: File): Promise<SupplierQuote> {
  const { rawText } = await extractTextFromFile(file);
  const classified = await classifyDocumentLLM(rawText, file.name);

  if (classified.items.length === 0) {
    throw new Error(
      `A LLM não identificou itens em "${file.name}". Verifique se o documento contém uma tabela de produtos.`
    );
  }

  const items: SupplierLineItem[] = classified.items.map((it) => ({
    id: uid(),
    rawTerm: it.rawTerm,
    quantidade: it.quantidade,
    unidadeAbrev: it.unidadeAbrev,
    unidadeHumana: it.unidadeHumana,
    isPromocao: it.isPromocao,
    valorUnit: it.valorUnit,
    valorTotal: it.valorTotal,
    matchedProductId: null,
    matchSource: null,
    matchScore: null,
  }));

  const supplierName =
    classified.supplierName.trim() || file.name.replace(/\.[^.]+$/, '');

  return {
    id: uid(),
    fileName: file.name,
    supplierName,
    status: 'processing',
    items,
  };
}

/** @deprecated Use parseSupplierFile — agora aceita todos os formatos. */
export const parseSupplierTextFile = parseSupplierFile;
