import type { OrderItem, PurchaseOrder } from '@/types';
import { normalizar } from '@/matching/normalize';
import { hashStrings, uid } from '@/lib/utils';
import { extractTextFromFile, getExt, isSupportedExt } from '@/lib/extractText';
import { classifyOrderLLM } from '@/matching/llmClassifyOrder';
import { isLLMConfigured } from '@/matching/llmDocumentClient';

/**
 * Pipeline da LISTA MESTRE (qualquer formato suportado):
 *  1. extractTextFromFile → texto bruto único.
 *  2. Se LLM configurada → classifyOrderLLM → items canônicos.
 *  3. Se LLM falhar OU vier vazia → fallback regex sobre o texto bruto.
 */
export async function parseOrderFile(file: File): Promise<PurchaseOrder> {
  const ext = getExt(file.name);
  if (!isSupportedExt(ext)) {
    throw new Error(
      `Formato não suportado: .${ext}. Use .docx, .pdf, .xlsx, .xls ou .txt.` +
        ` Para arquivos .doc legados, salve como .docx no Word/LibreOffice.`
    );
  }

  const { rawText } = await extractTextFromFile(file);

  if (isLLMConfigured() && rawText.trim().length > 0) {
    try {
      const resp = await classifyOrderLLM(rawText, file.name);
      const items = resp.items
        .filter((it) => it.nome && it.nome.trim().length > 0)
        .map((it, i) =>
          makeItem(
            it.nome.trim(),
            typeof it.quantidade === 'number' && !Number.isNaN(it.quantidade)
              ? it.quantidade
              : 1,
            (it.unidade || '').trim() || 'un',
            i
          )
        );
      if (items.length > 0) return packageOrder(file.name, items);
      // eslint-disable-next-line no-console
      console.warn('[order] LLM retornou lista vazia — caindo para fallback regex');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[order] LLM falhou — caindo para fallback regex:', e);
    }
  }

  const fallbackItems = extractFromPlainText(rawText);
  if (fallbackItems.length === 0) {
    throw new Error(
      `Não consegui extrair itens de "${file.name}". O documento parece não ter uma lista de itens reconhecível.`
    );
  }
  return packageOrder(file.name, fallbackItems);
}

/* -------------------- helpers -------------------- */

function extractFromPlainText(text: string): OrderItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 2);

  const items: OrderItem[] = [];
  for (const line of lines) {
    if (/^(item|produto|descri|qtd|unidade|tabela|lista)\s*[:\-]?$/i.test(line)) continue;
    if (/^#\s*aba:/i.test(line)) continue; // separador de aba do extractSpreadsheetText

    const parts = line.split(/\t|\s{2,}|;|\|/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      let desc = '';
      let qtd = 1;
      let uni = 'un';
      let descIdx = -1;
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

    const m1 = line.match(/^(\d+(?:[.,]\d+)?)\s*([a-záéíóúçã.]{1,8})?\s*[-–—:.]?\s*(.+)$/i);
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
