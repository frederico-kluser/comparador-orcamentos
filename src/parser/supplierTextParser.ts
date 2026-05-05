import mammoth from 'mammoth';
import type { SupplierLineItem, SupplierQuote } from '@/types';
import { uid } from '@/lib/utils';
import { readDocAsBestEffortText, readFileAsUtf8 } from '@/lib/textIO';
import { sanitizeText } from '@/lib/textSanitize';
import { classifyDocumentLLM } from '@/matching/llmClassifyDocument';

/**
 * Parser de DOCX/DOC/TXT — programação só extrai texto bruto.
 * A LLM faz toda a classificação (colunas, unidades, valores, promoção).
 */
export async function parseSupplierTextFile(file: File): Promise<SupplierQuote> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let rawText = '';

  if (ext === 'docx') {
    const arrayBuffer = await file.arrayBuffer();
    const r = await mammoth.extractRawText({ arrayBuffer });
    rawText = r.value || '';
  } else if (ext === 'doc') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const r = await mammoth.extractRawText({ arrayBuffer });
      rawText = r.value || '';
    } catch {
      rawText = '';
    }
    if (!rawText.trim()) rawText = await readDocAsBestEffortText(file);
  } else if (ext === 'txt') {
    rawText = await readFileAsUtf8(file);
  } else {
    throw new Error(`Formato não suportado: .${ext}`);
  }

  rawText = sanitizeText(rawText);
  if (!rawText.trim()) {
    throw new Error(`Arquivo "${file.name}" não tem texto extraível.`);
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
