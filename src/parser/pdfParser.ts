import type { SupplierLineItem, SupplierQuote } from '@/types';
import { uid } from '@/lib/utils';
import { extractPdfLines } from '@/lib/pdfText';
import { classifyDocumentLLM } from '@/matching/llmClassifyDocument';

/**
 * Parser de PDF — programação só extrai texto bruto. A LLM classifica
 * a tabela (descrição, quantidade, unidade humanizada, valores, promoção)
 * e identifica o nome do fornecedor.
 */
export async function parsePdf(file: File): Promise<SupplierQuote> {
  const lines = await extractPdfLines(file);
  const rawText = lines.map((l) => l.text).join('\n');

  if (!rawText.trim()) {
    throw new Error(
      `Não consegui extrair texto do PDF "${file.name}". Pode ser PDF escaneado/imagem.`
    );
  }

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

  return {
    id: uid(),
    fileName: file.name,
    supplierName: classified.supplierName,
    status: 'processing',
    items,
  };
}
