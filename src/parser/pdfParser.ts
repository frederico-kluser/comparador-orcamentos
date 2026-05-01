import { pdfjsLib } from '@/lib/pdfjs-setup';
import type { SupplierLineItem, SupplierQuote } from '@/types';
import { parseMoedaBR, parseQuantidadeBR, uid } from '@/lib/utils';

interface TextItemPos {
  str: string;
  x: number;
  y: number;
  width: number;
}

interface TextLine {
  y: number;
  items: TextItemPos[];
  text: string;
}

const RX_COL_DESC = /descri[çc][aã]o|produto|material|item/i;
const RX_COL_QTD = /qtd|quant|qntd/i;
const RX_COL_VAL_UNIT = /v[\.\s]*unit|pre[çc]o\s*unit|valor\s*unit|unit[áa]rio|p\.?\s*unit/i;
const RX_COL_VAL_TOT = /v[\.\s]*total|pre[çc]o\s*total|valor\s*total|subtotal|total/i;

// Linhas que devem ser ignoradas (rodapé/cabeçalho/totais)
const RX_IGNORE = /^(p[áa]gina|page|cnpj|cep|telefone|tel|fax|email|e-mail|endere[çc]o|forma\s*de\s*pagamento|prazo|validade|observa|^\s*total\s*geral|^\s*subtotal\s*$|^\s*desconto|^\s*frete)/i;

export async function parsePdf(file: File): Promise<SupplierQuote> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const allLines: TextLine[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: TextItemPos[] = [];

    for (const it of content.items as any[]) {
      if (!('str' in it) || !it.str?.trim()) continue;
      items.push({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        width: it.width || 0,
      });
    }

    const lines = groupByLine(items);
    allLines.push(...lines);
  }

  // tentativa 1: extrair pelo cabeçalho de coluna
  const cols = detectColumns(allLines);

  let extracted: SupplierLineItem[];
  if (cols) {
    extracted = extractByColumns(allLines, cols);
  } else {
    // tentativa 2: heurística sem cabeçalho
    extracted = extractByHeuristic(allLines);
  }

  if (extracted.length === 0) {
    throw new Error(
      `Não consegui extrair linhas de produto do PDF "${file.name}". O layout pode não ser reconhecível.`
    );
  }

  return {
    id: uid(),
    fileName: file.name,
    supplierName: extractSupplierName(allLines, file.name),
    status: 'processing',
    items: extracted,
  };
}

function groupByLine(items: TextItemPos[], tolerance = 2.5): TextLine[] {
  if (items.length === 0) return [];
  // ordena por y desc (origem PDF é canto inf-esquerdo)
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const lines: TextLine[] = [];

  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= tolerance) {
      last.items.push(it);
    } else {
      lines.push({ y: it.y, items: [it], text: '' });
    }
  }

  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
  }

  return lines;
}

interface ColumnsMap {
  descricao: number;
  quantidade: number;
  valorUnit: number;
  valorTotal: number;
}

function detectColumns(lines: TextLine[]): ColumnsMap | null {
  for (const l of lines) {
    const text = l.text.toLowerCase();
    if (RX_COL_DESC.test(text) && (RX_COL_QTD.test(text) || RX_COL_VAL_UNIT.test(text))) {
      // achamos uma linha que parece cabeçalho
      const cols: Partial<ColumnsMap> = {};
      for (const it of l.items) {
        const s = it.str.toLowerCase();
        if (RX_COL_DESC.test(s) && cols.descricao === undefined) cols.descricao = it.x;
        else if (RX_COL_QTD.test(s) && cols.quantidade === undefined) cols.quantidade = it.x;
        else if (RX_COL_VAL_UNIT.test(s) && cols.valorUnit === undefined) cols.valorUnit = it.x;
        else if (RX_COL_VAL_TOT.test(s) && cols.valorTotal === undefined) cols.valorTotal = it.x;
      }
      if (cols.descricao !== undefined && (cols.quantidade !== undefined || cols.valorUnit !== undefined)) {
        return {
          descricao: cols.descricao,
          quantidade: cols.quantidade ?? 0,
          valorUnit: cols.valorUnit ?? 0,
          valorTotal: cols.valorTotal ?? 0,
        };
      }
    }
  }
  return null;
}

function extractByColumns(lines: TextLine[], cols: ColumnsMap): SupplierLineItem[] {
  const items: SupplierLineItem[] = [];
  let foundHeader = false;

  for (const l of lines) {
    if (RX_IGNORE.test(l.text)) continue;
    // pula até passar do cabeçalho
    if (!foundHeader) {
      if (RX_COL_DESC.test(l.text.toLowerCase()) && (RX_COL_QTD.test(l.text.toLowerCase()) || RX_COL_VAL_UNIT.test(l.text.toLowerCase()))) {
        foundHeader = true;
      }
      continue;
    }

    // distribui tokens da linha pelas colunas mais próximas
    const buckets: Record<keyof ColumnsMap, string[]> = {
      descricao: [],
      quantidade: [],
      valorUnit: [],
      valorTotal: [],
    };

    for (const it of l.items) {
      const distances: Array<[keyof ColumnsMap, number]> = [
        ['descricao', Math.abs(it.x - cols.descricao)],
        ['quantidade', Math.abs(it.x - cols.quantidade)],
        ['valorUnit', Math.abs(it.x - cols.valorUnit)],
        ['valorTotal', Math.abs(it.x - cols.valorTotal)],
      ];
      distances.sort((a, b) => a[1] - b[1]);
      const closest = distances[0][0];
      buckets[closest].push(it.str);
    }

    const desc = buckets.descricao.join(' ').trim();
    if (!desc || desc.length < 3) continue;
    if (/^\d+\s*$/.test(desc)) continue; // descrição que é só um número

    const qtd = parseQuantidadeBR(buckets.quantidade.join(' '));
    const valUnit = parseMoedaBR(buckets.valorUnit.join(' '));
    const valTot = parseMoedaBR(buckets.valorTotal.join(' '));

    // só adiciona se tem ao menos um valor monetário
    if (!valUnit && !valTot) continue;

    items.push({
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

  return items;
}

function extractByHeuristic(lines: TextLine[]): SupplierLineItem[] {
  // Heurística simples: pega linhas que terminam com 1 ou 2 valores monetários
  const items: SupplierLineItem[] = [];
  const moneyRx = /R?\$?\s*\d{1,3}(?:\.\d{3})*(?:,\d{1,2})|R?\$?\s*\d+,\d{1,2}/g;

  for (const l of lines) {
    if (RX_IGNORE.test(l.text)) continue;
    const moneys = l.text.match(moneyRx);
    if (!moneys || moneys.length === 0) continue;

    // usa o último valor como total e o penúltimo como unitário (se existir)
    const valTot = parseMoedaBR(moneys[moneys.length - 1]);
    const valUnit = moneys.length >= 2 ? parseMoedaBR(moneys[moneys.length - 2]) : valTot;

    // descrição = tudo antes do primeiro valor monetário
    const firstMoneyIdx = l.text.indexOf(moneys[0]);
    let desc = l.text.substring(0, firstMoneyIdx).trim();
    // remove qty no final do desc, se houver: "produto X 10"
    const qtdMatch = desc.match(/(.+?)\s+(\d+(?:,\d+)?)\s*$/);
    let qtd: number | null = null;
    if (qtdMatch) {
      desc = qtdMatch[1].trim();
      qtd = parseQuantidadeBR(qtdMatch[2]);
    }

    if (!desc || desc.length < 3) continue;

    items.push({
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

  return items;
}

function extractSupplierName(lines: TextLine[], fallback: string): string {
  // pega as primeiras 5 linhas e procura algo que pareça nome de empresa
  const top = lines.slice(0, 8).map((l) => l.text);
  for (const t of top) {
    if (/ltda|s\.?a\.?|me\b|eireli|comercial|distribuidora|industria/i.test(t)) {
      return t.length > 80 ? t.slice(0, 80) : t;
    }
  }
  // senão usa primeira linha não trivial
  for (const t of top) {
    if (t.length > 3 && t.length < 80 && !/or[çc]amento|proposta/i.test(t)) {
      return t;
    }
  }
  return fallback.replace(/\.pdf$/i, '');
}
