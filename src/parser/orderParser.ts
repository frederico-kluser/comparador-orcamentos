import mammoth from 'mammoth';
import type { OrderItem, PurchaseOrder } from '@/types';
import { normalizar } from '@/matching/normalize';
import { hashStrings, uid } from '@/lib/utils';
import { readDocAsBestEffortText, readFileAsUtf8 } from '@/lib/textIO';

/**
 * Roteia o parsing da ordem de compra pelo tipo do arquivo.
 *
 * Suportados: .docx (mammoth), .doc (best-effort strings), .txt (UTF-8 puro).
 * Independente do formato, extrai uma lista de OrderItem com descrição,
 * quantidade e unidade.
 */
export async function parseOrderFile(file: File): Promise<PurchaseOrder> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  if (ext === 'docx') return parseFromDocx(file);
  if (ext === 'doc') return parseFromDoc(file);
  if (ext === 'txt') return parseFromTxt(file);

  throw new Error(`Formato não suportado: .${ext}. Use .docx, .doc ou .txt.`);
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

  const rawText = doc.body?.textContent || '';
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
  const items = extractFromPlainText(rawText);
  if (items.length === 0) {
    throw new Error(
      'Não consegui extrair itens do .doc. Recomendamos converter para .docx ou .txt (UTF-8) para melhor precisão.'
    );
  }
  return packageOrder(file.name, items);
}

async function parseFromTxt(file: File): Promise<PurchaseOrder> {
  const text = await readFileAsUtf8(file);
  const items = extractFromPlainText(text);
  if (items.length === 0) {
    throw new Error(
      'Nenhum item identificado no .txt. Use uma linha por item, no formato "qtd un - descrição" ou "descrição - qtd un".'
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

    const desc = (cells[colDesc]?.textContent || '').trim();
    if (!desc) continue;

    const qtdRaw = (cells[colQtd]?.textContent || '').trim();
    const qtd = parseFloat(qtdRaw.replace(',', '.')) || 1;
    const uni = colUni >= 0 ? (cells[colUni]?.textContent || '').trim() || 'un' : 'un';

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
