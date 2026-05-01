import mammoth from 'mammoth';
import type { SupplierLineItem, SupplierQuote } from '@/types';
import { parseMoedaBR, parseQuantidadeBR, uid } from '@/lib/utils';
import { readDocAsBestEffortText, readFileAsUtf8 } from '@/lib/textIO';
import { sanitizeText } from '@/lib/textSanitize';

/**
 * Parser para orçamentos/notas de fornecedores em texto plano.
 * Suporta .docx, .doc e .txt — tudo lido como UTF-8 quando possível.
 *
 * Estratégia: extrai TEXTO BRUTO e roda heurística por linha
 * procurando valores monetários BR no formato "1.234,56".
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
  const items = extractItemsFromText(rawText);
  if (items.length === 0) {
    throw new Error(
      `Não consegui extrair linhas com preço de "${file.name}". O texto precisa ter linhas com valores em formato BR (ex.: "Produto X 10 R$ 12,50").`
    );
  }

  return {
    id: uid(),
    fileName: file.name,
    supplierName: detectSupplierName(rawText, file.name),
    status: 'processing',
    items,
  };
}

const RX_IGNORE = /^(p[áa]gina|page|cnpj|cep|telefone|tel|fax|e-?mail|endere[çc]o|forma\s*de\s*pagamento|prazo|validade|observa|^\s*total\s*geral|^\s*subtotal\s*$|^\s*desconto|^\s*frete)/i;
const RX_MONEY = /R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}|R?\$?\s*\d+,\d{2}/g;

function extractItemsFromText(text: string): SupplierLineItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 2);

  const out: SupplierLineItem[] = [];

  for (const line of lines) {
    if (RX_IGNORE.test(line)) continue;
    const moneys = line.match(RX_MONEY);
    if (!moneys || moneys.length === 0) continue;

    const valTot = parseMoedaBR(moneys[moneys.length - 1]);
    const valUnit = moneys.length >= 2 ? parseMoedaBR(moneys[moneys.length - 2]) : valTot;

    const firstMoneyIdx = line.indexOf(moneys[0]);
    let desc = line.substring(0, firstMoneyIdx).trim();
    desc = desc.replace(/[\-:|]+$/, '').trim();

    const qtdMatch = desc.match(/(.+?)\s+(\d+(?:[.,]\d+)?)\s*([a-záéíóúçã]{1,5})?\s*$/i);
    let qtd: number | null = null;
    if (qtdMatch) {
      desc = qtdMatch[1].trim();
      qtd = parseQuantidadeBR(qtdMatch[2]);
    }

    if (!desc || desc.length < 3) continue;
    if (!valUnit && !valTot) continue;

    out.push({
      id: uid(),
      rawTerm: desc,
      quantidade: qtd,
      valorUnit: valUnit?.toString() ?? null,
      valorTotal: valTot?.toString() ?? null,
      matchedProductId: null,
      matchSource: null,
      matchScore: null,
    });
  }

  return out;
}

function detectSupplierName(text: string, fallback: string): string {
  const top = text.split(/\r?\n/).slice(0, 8).map((l) => l.trim()).filter(Boolean);
  for (const t of top) {
    if (/ltda|s\.?a\.?|me\b|eireli|comercial|distribuidora|industria/i.test(t)) {
      return t.length > 80 ? t.slice(0, 80) : t;
    }
  }
  for (const t of top) {
    if (t.length > 3 && t.length < 80 && !/or[çc]amento|proposta/i.test(t)) return t;
  }
  return fallback.replace(/\.[^.]+$/, '');
}
