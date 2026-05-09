import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { DOC_LEGACY_ERROR, looksLikeCfbGarbage, readFileAsUtf8 } from './textIO';
import { sanitizeText } from './textSanitize';
import { extractPdfLines } from './pdfText';

/**
 * Extração de TEXTO BRUTO unificada por extensão. Cada formato tem seu próprio
 * extrator; nenhuma lógica de parsing/classificação aqui — só texto plano.
 *
 * Formatos suportados: .docx, .pdf, .txt, .csv, .xlsx, .xls, e (best-effort) .doc.
 *
 * Estratégia .doc (CFB/OLE binário, Word 97-2003):
 *   - tenta `mammoth.extractRawText` (oficialmente .docx, mas às vezes lê
 *     .doc moderno);
 *   - se devolver vazio OU lixo CFB (detectado por `looksLikeCfbGarbage`,
 *     que procura nomes de stream tipo "Root Entry"/"WordDocument"/
 *     "SummaryInformation" e estilos default que vazam quando o byte-scan
 *     pega metadata em vez do conteúdo real), JOGA erro acionável apontando
 *     o caminho de conversão pra .docx/.pdf.
 *   - NÃO usa o byte-scan latin-1 antigo (`readDocAsBestEffortText`): em todos
 *     os testes ele extraiu metadata em vez do conteúdo, e a LLM/regex
 *     downstream criava itens fantasmas.
 */

export type ExtractSource =
  | 'docx'
  | 'doc'
  | 'pdf'
  | 'txt'
  | 'csv'
  | 'xlsx'
  | 'xls';

export interface ExtractResult {
  rawText: string;
  source: ExtractSource;
}

const SUPPORTED = ['docx', 'doc', 'pdf', 'txt', 'csv', 'xlsx', 'xls'] as const;
export type SupportedExt = (typeof SUPPORTED)[number];

export function isSupportedExt(ext: string): ext is SupportedExt {
  return (SUPPORTED as readonly string[]).includes(ext);
}

export function getExt(fileName: string): string {
  return (fileName.split('.').pop() || '').toLowerCase();
}

export async function extractTextFromFile(file: File): Promise<ExtractResult> {
  const ext = getExt(file.name);
  if (!isSupportedExt(ext)) {
    throw new Error(
      `Formato não suportado: .${ext}. Use .docx, .pdf, .xlsx, .xls, .txt ou .csv.` +
        ` Para arquivos .doc legados, salve como .docx no Word/LibreOffice.`
    );
  }

  let rawText = '';
  let source: ExtractSource;

  if (ext === 'docx') {
    const arrayBuffer = await file.arrayBuffer();
    const r = await mammoth.extractRawText({ arrayBuffer });
    rawText = r.value || '';
    source = 'docx';
  } else if (ext === 'doc') {
    let mammothText = '';
    try {
      const arrayBuffer = await file.arrayBuffer();
      const r = await mammoth.extractRawText({ arrayBuffer });
      mammothText = (r.value || '').trim();
    } catch {
      mammothText = '';
    }
    // mammoth oficialmente só suporta .docx. Se conseguir, validamos com a
    // stop-list de strings CFB — se vier metadata em vez de conteúdo, abortar.
    if (!mammothText || looksLikeCfbGarbage(mammothText)) {
      throw new Error(DOC_LEGACY_ERROR);
    }
    rawText = mammothText;
    source = 'doc';
  } else if (ext === 'pdf') {
    const lines = await extractPdfLines(file);
    rawText = lines.map((l) => l.text).join('\n');
    source = 'pdf';
  } else if (ext === 'txt' || ext === 'csv') {
    rawText = await readFileAsUtf8(file);
    source = ext;
  } else if (ext === 'xlsx' || ext === 'xls') {
    rawText = await extractSpreadsheetText(file);
    source = ext;
  } else {
    // exhaustive guard (TS narrowing)
    throw new Error(`Formato não suportado: .${ext}`);
  }

  rawText = sanitizeText(rawText);

  // Sanity check pós-sanitização: mesmo após mammoth, conteúdo pode vir vazio
  // ou ainda parecer lixo CFB num caso patológico. Guarda extra.
  if (!rawText.trim()) {
    if (ext === 'pdf') {
      throw new Error(
        `Não consegui extrair texto de "${file.name}". O PDF parece ser escaneado/imagem (sem camada de texto). Tente exportar como .docx, .xlsx ou .txt.`
      );
    }
    throw new Error(
      `Não consegui extrair texto de "${file.name}". O arquivo parece vazio ou corrompido.`
    );
  }
  if (looksLikeCfbGarbage(rawText)) {
    throw new Error(DOC_LEGACY_ERROR);
  }

  return { rawText, source };
}

/**
 * Lê uma planilha .xlsx/.xls (binário, auto-detect) e produz um texto plano
 * com todas as abas. Cada aba é precedida por um marcador `# Aba: <nome>`
 * para a LLM distinguir; células vão como TSV (tab + newline).
 */
async function extractSpreadsheetText(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const blocks: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const tsv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t', RS: '\n', blankrows: false });
    if (tsv.trim().length === 0) continue;
    blocks.push(`# Aba: ${sheetName}\n${tsv}`);
  }
  return blocks.join('\n\n');
}
