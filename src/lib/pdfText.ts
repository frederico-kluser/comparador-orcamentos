import { pdfjsLib } from '@/lib/pdfjs-setup';
import { sanitizeText } from '@/lib/textSanitize';

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

export interface PdfTextLine {
  y: number;
  items: PdfTextItem[];
  text: string;
}

/**
 * Extrai linhas de texto de um PDF, agrupadas por coordenada Y.
 * Compartilhado entre o parser de orçamento de fornecedor e o de
 * ordem de compra.
 */
export async function extractPdfLines(
  file: File,
  tolerance = 2.5
): Promise<PdfTextLine[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const lines: PdfTextLine[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];

    for (const it of content.items as any[]) {
      if (!('str' in it) || !it.str?.trim()) continue;
      const str = sanitizeText(it.str as string);
      if (!str.trim()) continue;
      items.push({
        str,
        x: it.transform[4],
        y: it.transform[5],
        width: it.width || 0,
      });
    }

    lines.push(...groupByLine(items, tolerance));
  }

  return lines;
}

function groupByLine(items: PdfTextItem[], tolerance: number): PdfTextLine[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const lines: PdfTextLine[] = [];

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
    l.text = l.items
      .map((i) => i.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return lines;
}
