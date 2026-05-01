import mammoth from 'mammoth';
import type { OrderItem, PurchaseOrder } from '@/types';
import { normalizar } from '@/matching/normalize';
import { hashStrings, uid } from '@/lib/utils';
import { readDocAsBestEffortText, readFileAsUtf8 } from '@/lib/textIO';
import { sanitizeText } from '@/lib/textSanitize';
import { extractPdfLines, type PdfTextLine } from '@/lib/pdfText';

/**
 * Roteia o parsing da ordem de compra pelo tipo do arquivo.
 *
 * Suportados: .docx (mammoth), .doc (best-effort strings), .pdf (pdfjs),
 * .txt (UTF-8 puro). Independente do formato, extrai uma lista de OrderItem
 * com descrição, quantidade e unidade.
 */
export async function parseOrderFile(file: File): Promise<PurchaseOrder> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  if (ext === 'docx') return parseFromDocx(file);
  if (ext === 'doc') return parseFromDoc(file);
  if (ext === 'pdf') return parseFromPdf(file);
  if (ext === 'txt') return parseFromTxt(file);

  throw new Error(`Formato não suportado: .${ext}. Use .docx, .doc, .pdf ou .txt.`);
}

async function parseFromDocx(file: File): Promise<PurchaseOrder> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });

  const doc = new DOMParser().parseFromString(result.value, 'text/html');
  const tables = doc.querySelectorAll('table');

  if (tables.length > 0) {
    const items = extractFromHtmlTables(tables);
    if (items.length > 0) return packageOrder(file.name, items);
  }

  const rawText = sanitizeText(doc.body?.textContent || '');
  const items = extractFromPlainText(rawText);
  if (items.length === 0) {
    throw new Error(
      'Não consegui extrair itens do .docx. Verifique se há tabela [Descrição, Quantidade, Unidade] ou linhas no formato "qtd un - descrição".'
    );
  }
  return packageOrder(file.name, items);
}

async function parseFromDoc(file: File): Promise<PurchaseOrder> {
  // .doc binário (CFB/OLE) — mammoth não suporta. Tenta primeiro,
  // cai para extração best-effort se falhar.
  let rawText = '';
  try {
    const arrayBuffer = await file.arrayBuffer();
    const r = await mammoth.extractRawText({ arrayBuffer });
    rawText = r.value || '';
  } catch {
    rawText = '';
  }
  if (!rawText.trim()) {
    rawText = await readDocAsBestEffortText(file);
  }
  rawText = sanitizeText(rawText);
  const items = extractFromPlainText(rawText);
  if (items.length === 0) {
    throw new Error(
      'Não consegui extrair itens do .doc. Recomendamos converter para .docx ou .txt (UTF-8) para melhor precisão.'
    );
  }
  return packageOrder(file.name, items);
}

async function parseFromTxt(file: File): Promise<PurchaseOrder> {
  const text = sanitizeText(await readFileAsUtf8(file));
  const items = extractFromPlainText(text);
  if (items.length === 0) {
    throw new Error(
      'Nenhum item identificado no .txt. Use uma linha por item, no formato "qtd un - descrição" ou "descrição - qtd un".'
    );
  }
  return packageOrder(file.name, items);
}

async function parseFromPdf(file: File): Promise<PurchaseOrder> {
  const lines = await extractPdfLines(file);
  // 1ª tentativa: detectar colunas (Descrição/Qtd/Unidade) por posição x
  let items = extractFromPdfColumns(lines);
  // 2ª tentativa: texto plano usando heurísticas existentes
  if (items.length === 0) {
    const flat = sanitizeText(lines.map((l) => l.text).join('\n'));
    items = extractFromPlainText(flat);
  }
  if (items.length === 0) {
    throw new Error(
      `Não consegui extrair itens do PDF "${file.name}". O layout pode não ser reconhecível — tente exportar a ordem como .docx ou .txt.`
    );
  }
  return packageOrder(file.name, items);
}

/* -------------------- helpers -------------------- */

function extractFromHtmlTables(tables: NodeListOf<HTMLTableElement>): OrderItem[] {
  let chosenTable: HTMLTableElement | null = null;
  for (const t of Array.from(tables)) {
    if (t.querySelectorAll('tr').length > 1) {
      chosenTable = t;
      break;
    }
  }
  if (!chosenTable) return [];

  const rows = Array.from(chosenTable.querySelectorAll('tr'));
  const headerRow = rows[0];
  const headerTexts = Array.from(headerRow.querySelectorAll('th, td')).map(
    (c) => (c.textContent || '').trim().toLowerCase()
  );

  let colDesc = -1, colQtd = -1, colUni = -1;
  headerTexts.forEach((h, i) => {
    if (/descri|produto|item/i.test(h) && colDesc === -1) colDesc = i;
    else if (/qtd|quant/i.test(h)) colQtd = i;
    else if (/unidade|unid|un\.?$/i.test(h)) colUni = i;
  });

  let dataStartRow = 1;
  if (colDesc === -1) {
    if (headerTexts.length >= 4) { colDesc = 1; colQtd = 2; colUni = 3; }
    else if (headerTexts.length === 3) { colDesc = 0; colQtd = 1; colUni = 2; }
    else if (headerTexts.length === 2) { colDesc = 0; colQtd = 1; colUni = -1; }
    dataStartRow = 0;
  }

  const items: OrderItem[] = [];
  for (let i = dataStartRow; i < rows.length; i++) {
    const cells = Array.from(rows[i].querySelectorAll('td'));
    if (cells.length === 0) continue;

    const desc = sanitizeText(cells[colDesc]?.textContent || '').trim();
    if (!desc) continue;

    const qtdRaw = sanitizeText(cells[colQtd]?.textContent || '').trim();
    const qtd = parseFloat(qtdRaw.replace(',', '.')) || 1;
    const uni =
      colUni >= 0
        ? sanitizeText(cells[colUni]?.textContent || '').trim() || 'un'
        : 'un';

    items.push({
      id: `oi_${i}_${uid()}`,
      descricao: desc,
      descricaoNormalizada: normalizar(desc),
      quantidade: qtd,
      unidade: uni,
    });
  }
  return items;
}

function extractFromPlainText(text: string): OrderItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 2);

  const items: OrderItem[] = [];
  for (const line of lines) {
    // ignora cabeçalhos comuns
    if (/^(item|produto|descri|qtd|unidade|tabela|lista)\s*[:\-]?$/i.test(line)) continue;

    // Padrão TSV/CSV: separadores tab|;|múltiplos espaços
    const parts = line.split(/\t|\s{2,}|;|\|/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      // tenta achar uma coluna numérica e uma textual longa
      let desc = '';
      let qtd = 1;
      let uni = 'un';
      let descIdx = -1;
      // descrição é o token mais longo
      let maxLen = 0;
      parts.forEach((p, i) => {
        if (p.length > maxLen && !/^\d+([.,]\d+)?$/.test(p)) {
          maxLen = p.length;
          descIdx = i;
        }
      });
      if (descIdx >= 0) {
        desc = parts[descIdx];
        for (let i = 0; i < parts.length; i++) {
          if (i === descIdx) continue;
          if (/^\d+(?:[.,]\d+)?$/.test(parts[i])) {
            qtd = parseFloat(parts[i].replace(',', '.')) || 1;
          } else if (/^(un|und|unidade|kg|g|l|ml|cx|caixa|pç|pc|m|cm|mm)$/i.test(parts[i])) {
            uni = parts[i];
          }
        }
        if (desc) {
          items.push(makeItem(desc, qtd, uni, items.length));
          continue;
        }
      }
    }

    // Padrão "10 un - descrição" ou "10 un descrição"
    const m1 = line.match(/^(\d+(?:[.,]\d+)?)\s*([a-záéíóúçã.]{1,8})?\s*[-–—:.]?\s*(.+)$/i);
    // Padrão "descrição - 10 un"
    const m2 = line.match(/^(.+?)\s*[-–—:]\s*(\d+(?:[.,]\d+)?)\s*([a-záéíóúçã.]{1,8})?$/i);

    let desc = '', qtd = 1, uni = 'un';
    if (m2 && m2[1].length > 3) {
      desc = m2[1].trim();
      qtd = parseFloat(m2[2].replace(',', '.')) || 1;
      uni = (m2[3] || 'un').replace(/[.,]$/, '');
    } else if (m1 && m1[3] && m1[3].length > 3) {
      qtd = parseFloat(m1[1].replace(',', '.')) || 1;
      uni = (m1[2] || 'un').replace(/[.,]$/, '');
      desc = m1[3].trim();
    } else if (line.length > 3 && /[a-zà-ú]/i.test(line)) {
      desc = line;
    }

    if (desc) items.push(makeItem(desc, qtd, uni, items.length));
  }
  return items;
}

function makeItem(desc: string, qtd: number, uni: string, idx: number): OrderItem {
  return {
    id: `oi_${idx}_${uid()}`,
    descricao: desc,
    descricaoNormalizada: normalizar(desc),
    quantidade: qtd,
    unidade: uni,
  };
}

function packageOrder(fileName: string, items: OrderItem[]): PurchaseOrder {
  return {
    id: uid(),
    fileName,
    createdAt: Date.now(),
    items,
    hash: hashStrings(items.map((it) => it.descricaoNormalizada)),
  };
}

/* ------------- PDF: extração por colunas ------------- */

const RX_HDR_DESC = /descri[çc][aã]o|produto|material|especifica/i;
const RX_HDR_QTD = /qtd|quant|qntd/i;
const RX_HDR_UNI = /^un\.?$|unid(?:ade)?/i;
const RX_HDR_COD = /^c[óo]d\.?$|c[óo]digo|item/i;

const RX_PDF_IGNORE = /^(p[áa]gina|page|cnpj|cep|telefone|tel|fax|e-?mail|endere[çc]o|forma\s*de\s*pagamento|prazo|validade|observa|^\s*total\s*geral|^\s*subtotal\s*$|^\s*desconto|^\s*frete|or[çc]amento|proposta|ordem\s+de\s+compra)/i;

interface OrderColsMap {
  codigo: number | null;
  descricao: number;
  quantidade: number;
  unidade: number | null;
}

/**
 * Tenta extrair itens da ordem em PDF localizando uma linha de cabeçalho
 * (descrição + qtd) e mapeando posições x. Funciona pra PDFs gerados com
 * texto extraível (não-imagem).
 */
function extractFromPdfColumns(lines: PdfTextLine[]): OrderItem[] {
  const cols = detectOrderColumns(lines);
  if (!cols) return [];

  const items: OrderItem[] = [];
  let pastHeader = false;

  for (const l of lines) {
    if (RX_PDF_IGNORE.test(l.text)) continue;
    if (!pastHeader) {
      if (RX_HDR_DESC.test(l.text) && RX_HDR_QTD.test(l.text)) pastHeader = true;
      continue;
    }

    const buckets: Record<'codigo' | 'descricao' | 'quantidade' | 'unidade', string[]> = {
      codigo: [],
      descricao: [],
      quantidade: [],
      unidade: [],
    };

    for (const it of l.items) {
      const candidates: Array<['codigo' | 'descricao' | 'quantidade' | 'unidade', number]> = [
        ['descricao', Math.abs(it.x - cols.descricao)],
        ['quantidade', Math.abs(it.x - cols.quantidade)],
      ];
      if (cols.unidade !== null) candidates.push(['unidade', Math.abs(it.x - cols.unidade)]);
      if (cols.codigo !== null) candidates.push(['codigo', Math.abs(it.x - cols.codigo)]);
      candidates.sort((a, b) => a[1] - b[1]);
      buckets[candidates[0][0]].push(it.str);
    }

    const desc = buckets.descricao.join(' ').trim();
    if (!desc || desc.length < 3) continue;
    if (/^\d+\s*$/.test(desc)) continue;

    const qtdRaw = buckets.quantidade.join(' ').trim();
    const qtdMatch = qtdRaw.match(/(\d+(?:[.,]\d+)?)/);
    const qtd = qtdMatch ? parseFloat(qtdMatch[1].replace(',', '.')) || 1 : 1;

    let uni = (buckets.unidade.join(' ').trim() || 'un').toLowerCase();
    uni = uni.replace(/[.,;:]+$/, '').trim() || 'un';

    items.push({
      id: `oi_${items.length}_${uid()}`,
      descricao: desc,
      descricaoNormalizada: normalizar(desc),
      quantidade: qtd,
      unidade: uni,
    });
  }

  return items;
}

function detectOrderColumns(lines: PdfTextLine[]): OrderColsMap | null {
  for (const l of lines) {
    if (!(RX_HDR_DESC.test(l.text) && RX_HDR_QTD.test(l.text))) continue;

    const cols: { codigo?: number; descricao?: number; quantidade?: number; unidade?: number } = {};
    for (const it of l.items) {
      const s = it.str.trim();
      if (!s) continue;
      if (RX_HDR_DESC.test(s) && cols.descricao === undefined) cols.descricao = it.x;
      else if (RX_HDR_QTD.test(s) && cols.quantidade === undefined) cols.quantidade = it.x;
      else if (RX_HDR_UNI.test(s) && cols.unidade === undefined) cols.unidade = it.x;
      else if (RX_HDR_COD.test(s) && cols.codigo === undefined) cols.codigo = it.x;
    }
    if (cols.descricao !== undefined && cols.quantidade !== undefined) {
      return {
        codigo: cols.codigo ?? null,
        descricao: cols.descricao,
        quantidade: cols.quantidade,
        unidade: cols.unidade ?? null,
      };
    }
  }
  return null;
}
