import mammoth from 'mammoth';
import type { OrderItem, PurchaseOrder } from '@/types';
import { normalizar } from '@/matching/normalize';
import { hashStrings, uid } from '@/lib/utils';

/**
 * Parseia um arquivo .docx contendo a ordem de compra.
 * Espera que a ordem esteja em formato de tabela com colunas:
 * [Item, Descrição, Quantidade, Unidade]
 *
 * Estratégia: usa mammoth para converter em HTML; pega a primeira tabela
 * com pelo menos 2 colunas; tenta detectar quais colunas são qual.
 */
export async function parseDocx(file: File): Promise<PurchaseOrder> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });

  const doc = new DOMParser().parseFromString(result.value, 'text/html');
  const tables = doc.querySelectorAll('table');

  if (tables.length === 0) {
    // Fallback: tenta extrair linhas de parágrafos como "1. produto X - 10 un"
    return parseDocxAsParagraphs(result.value, file.name);
  }

  // pega a primeira tabela com mais de 1 linha
  let chosenTable: HTMLTableElement | null = null;
  for (const t of Array.from(tables)) {
    if (t.querySelectorAll('tr').length > 1) {
      chosenTable = t;
      break;
    }
  }
  if (!chosenTable) {
    return parseDocxAsParagraphs(result.value, file.name);
  }

  const rows = Array.from(chosenTable.querySelectorAll('tr'));
  const headerRow = rows[0];
  const headerTexts = Array.from(headerRow.querySelectorAll('th, td')).map(
    (c) => (c.textContent || '').trim().toLowerCase()
  );

  // detectar colunas pelo cabeçalho
  let colDesc = -1, colQtd = -1, colUni = -1;
  headerTexts.forEach((h, i) => {
    if (/descri|produto|item/i.test(h) && colDesc === -1) colDesc = i;
    else if (/qtd|quant/i.test(h)) colQtd = i;
    else if (/unidade|unid|un\.?$/i.test(h)) colUni = i;
  });

  // se não detectou, assume layout padrão: [#, descrição, qtd, unidade]
  let dataStartRow = 1;
  if (colDesc === -1) {
    // tenta sem cabeçalho
    if (headerTexts.length >= 4) {
      colDesc = 1; colQtd = 2; colUni = 3;
    } else if (headerTexts.length === 3) {
      colDesc = 0; colQtd = 1; colUni = 2;
    } else if (headerTexts.length === 2) {
      colDesc = 0; colQtd = 1; colUni = -1;
    }
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

  if (items.length === 0) {
    throw new Error(
      'Não consegui extrair itens do .docx. Verifique se há uma tabela com colunas [Descrição, Quantidade, Unidade].'
    );
  }

  return {
    id: uid(),
    fileName: file.name,
    createdAt: Date.now(),
    items,
    hash: hashStrings(items.map((it) => it.descricaoNormalizada)),
  };
}

function parseDocxAsParagraphs(html: string, fileName: string): PurchaseOrder {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const paras = Array.from(doc.querySelectorAll('p, li'));
  const items: OrderItem[] = [];

  for (const p of paras) {
    const text = (p.textContent || '').trim();
    if (!text || text.length < 3) continue;
    // tenta padrões: "10 un - Produto X" ou "Produto X - 10 un"
    const m1 = text.match(/^(\d+(?:[.,]\d+)?)\s*(\w+)?\s*[-–—:.]\s*(.+)$/);
    const m2 = text.match(/^(.+?)\s*[-–—:]\s*(\d+(?:[.,]\d+)?)\s*(\w+)?$/);
    let desc = '', qtd = 1, uni = 'un';
    if (m1) {
      qtd = parseFloat(m1[1].replace(',', '.'));
      uni = m1[2] || 'un';
      desc = m1[3].trim();
    } else if (m2) {
      desc = m2[1].trim();
      qtd = parseFloat(m2[2].replace(',', '.'));
      uni = m2[3] || 'un';
    } else {
      desc = text;
    }

    if (desc) {
      items.push({
        id: `oi_p${items.length}_${uid()}`,
        descricao: desc,
        descricaoNormalizada: normalizar(desc),
        quantidade: qtd,
        unidade: uni,
      });
    }
  }

  if (items.length === 0) {
    throw new Error('Não consegui extrair itens do documento.');
  }

  return {
    id: uid(),
    fileName,
    createdAt: Date.now(),
    items,
    hash: hashStrings(items.map((it) => it.descricaoNormalizada)),
  };
}
