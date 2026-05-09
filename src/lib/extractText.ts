import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { readDocAsBestEffortText, readFileAsUtf8 } from './textIO';
import { sanitizeText } from './textSanitize';
import { extractPdfLines } from './pdfText';

/**
 * Extração de TEXTO BRUTO unificada por extensão. Cada formato tem seu próprio
 * extrator; nenhuma lógica de parsing/classificação aqui — só texto plano.
 *
 * Formatos suportados: .docx, .doc, .pdf, .txt, .xlsx, .xls.
 *
 * Estratégia .doc (CFB/OLE binário): mammoth raw text → fallback latin-1/UTF-16
 * (`readDocAsBestEffortText`) → se ambos vazios, joga erro com mensagem
 * acionável ("salve como .docx"). Sandboxed Electron renderer não permite
 * word-extractor (Node-only), por isso a estratégia best-effort.
 */

export type ExtractSource =
  | 'docx'
  | 'doc'
  | 'doc-best-effort'
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
      `Formato não suportado: .${ext}. Use .docx, .pdf, .xlsx, .xls ou .txt.` +
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
    // mammoth às vezes consegue ler .doc novos; senão, best-effort binário.
    try {
      const arrayBuffer = await file.arrayBuffer();
      const r = await mammoth.extractRawText({ arrayBuffer });
      rawText = r.value || '';
    } catch {
      rawText = '';
    }
    if (!rawText.trim()) {
      rawText = await readDocAsBestEffortText(file);
      source = 'doc-best-effort';
    } else {
      source = 'doc';
    }
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

  if (!rawText.trim()) {
    if (ext === 'doc') {
      throw new Error(
        `Não consegui extrair texto de "${file.name}" (.doc legado). Abra o arquivo no Word ou LibreOffice e use Salvar como → .docx (ou .pdf), depois envie de novo.`
      );
    }
    if (ext === 'pdf') {
      throw new Error(
        `Não consegui extrair texto de "${file.name}". O PDF parece ser escaneado/imagem (sem camada de texto). Tente exportar como .docx, .xlsx ou .txt.`
      );
    }
    throw new Error(
      `Não consegui extrair texto de "${file.name}". O arquivo parece vazio ou corrompido.`
    );
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
